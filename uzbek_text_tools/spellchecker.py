import re

from rapidfuzz.distance import Levenshtein as _rfl

from .stemmer import strip_suffix, _SORTED_SUFFIXES, MIN_STEM_LEN
from .data_loader import load_dictionary
from .tokenizer import word_tokens

# ---------------------------------------------------------------------------
# Apostrophe normalisation — all Uzbek apostrophe variants map to ASCII '
# so that o'quvchi / oʻquvchi / oʼquvchi are treated as the same word.
# ---------------------------------------------------------------------------
_APO_NORM_TABLE = str.maketrans("ʻʼ", "''")


def _normalise_apo(word: str) -> str:
    """Normalise Unicode apostrophes (ʻ U+02BB, ʼ U+02BC) to ASCII '."""
    return word.translate(_APO_NORM_TABLE)

# ---------------------------------------------------------------------------
# Weighted edit distance
# ---------------------------------------------------------------------------
# Letter pairs that Uzbek writers frequently confuse get a substitution cost
# of 0.5 instead of 1.0, so the affected candidates rank closer to the input.
# Minimum corpus frequency a stripped stem must have to be accepted as a
# real root.  Prevents false agglutination matches where a typo's stripped
# form coincidentally equals a rare dictionary entry (e.g. "yiilda" → "yiil",
# freq=3).  Real Uzbek roots that users actually suffix are common words;
# a threshold of 100 rejects ~99% of coincidental matches while keeping
# all practical roots (kitob=12k, maktab=12k, yil=483k, etc.).
MIN_STEM_FREQ: int = 100

# Minimum corpus frequency for a word to be accepted as correct via
# direct lookup.  Rejects ultra-rare corpus noise entries (freq ≤ 4)
# that are almost always OCR/scraping artefacts or uncorrected typos
# (e.g. 'yaxhsi' freq=5, 'oʻquvchii' freq=3).
MIN_DIRECT_FREQ: int = 5

UZBEK_CONFUSIONS: dict[tuple[str, str], float] = {
    # x / h  — both represent similar fricative sounds in many Uzbek dialects
    ("x", "h"): 0.5, ("h", "x"): 0.5,
    # i / y  — short-vowel / semivowel alternation common in informal writing
    ("i", "y"): 0.5, ("y", "i"): 0.5,
    # u / o  — rounded back vowels, often interchanged in fast speech
    ("u", "o"): 0.5, ("o", "u"): 0.5,
    # b / p  — voiced/unvoiced stop, devoiced at syllable end
    ("b", "p"): 0.5, ("p", "b"): 0.5,
    # d / t  — voiced/unvoiced stop, same devoicing pattern
    ("d", "t"): 0.5, ("t", "d"): 0.5,
    # Apostrophe variants — all represent the same phoneme (oʻ/gʻ marker)
    ("'", "ʻ"): 0.0, ("ʻ", "'"): 0.0,
    ("'", "ʼ"): 0.0, ("ʼ", "'"): 0.0,
    ("ʻ", "ʼ"): 0.0, ("ʼ", "ʻ"): 0.0,
}


_MAX_DIST = 2.0   # suggest() threshold — used for early exit

# Apostrophe characters — inserting or deleting these costs only 0.3
# because Uzbek writers very commonly drop the oʻ/gʻ apostrophe.
_APOSTROPHES: frozenset = frozenset("'ʻʼ")
_APO_COST: float = 0.3


def weighted_distance(a: str, b: str, cutoff: float = _MAX_DIST) -> float:
    """
    Levenshtein distance with reduced substitution cost for known Uzbek
    letter confusions (see UZBEK_CONFUSIONS) and reduced insertion/deletion
    cost for apostrophe characters (0.3 instead of 1.0).

    Two performance optimisations over the naïve O(m×n) implementation:

    1. **Single rolling array** — only one row of the DP table is kept in
       memory at a time, halving allocations and improving cache locality.

    2. **Early exit** — if every cell in the current row already exceeds
       *cutoff* (default 2.0) the strings are too different; we return
       ``cutoff + 1`` immediately.  In practice this skips >80 % of the
       inner-loop work for the typical ~80k candidates per query word.
    """
    m, n = len(a), len(b)

    # prev[j] = cost of aligning a[:i-1] with b[:j]
    # Initial row: inserting b[0..j], with reduced cost for apostrophes
    prev = [0.0] * (n + 1)
    for j in range(1, n + 1):
        prev[j] = prev[j - 1] + (_APO_COST if b[j - 1] in _APOSTROPHES else 1.0)

    for i in range(1, m + 1):
        # Cost of deleting a[0..i]
        del_cost_ai = _APO_COST if a[i - 1] in _APOSTROPHES else 1.0
        curr = [prev[0] + del_cost_ai] + [0.0] * n
        row_min = curr[0]

        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                sub_cost = 0.0
            else:
                sub_cost = UZBEK_CONFUSIONS.get((a[i - 1], b[j - 1]), 1.0)

            # Deletion cost: removing a[i-1] (reduced if it's an apostrophe)
            del_cost = _APO_COST if a[i - 1] in _APOSTROPHES else 1.0
            # Insertion cost: inserting b[j-1] (reduced if it's an apostrophe)
            ins_cost = _APO_COST if b[j - 1] in _APOSTROPHES else 1.0

            curr[j] = min(
                prev[j] + del_cost,      # deletion
                curr[j - 1] + ins_cost,  # insertion
                prev[j - 1] + sub_cost,  # substitution
            )
            if curr[j] < row_min:
                row_min = curr[j]

        # Early exit: no cell in this row is within cutoff → impossible to recover
        if row_min > cutoff:
            return cutoff + 1.0

        prev = curr

    return prev[n]


class UzbekSpellChecker:
    def __init__(self):
        raw_freq: dict[str, int] = load_dictionary()
        # Normalise apostrophe variants so that oʻquvchi and o'quvchi merge.
        # Frequencies of duplicate forms are summed.
        self.word_freq: dict[str, int] = {}
        for word, freq in raw_freq.items():
            norm = _normalise_apo(word)
            self.word_freq[norm] = self.word_freq.get(norm, 0) + freq
        self.vocabulary: set[str] = set(self.word_freq.keys())
        # Character-bucket index: maps (first_char, word_length) → list[word]
        # Built once at init; cuts candidate retrieval from O(|vocab|) to O(bucket).
        # A word may appear in multiple buckets when its first char is part of a
        # confusion pair (e.g. 'xato' is in bucket ('x',4) AND ('h',4) so a query
        # starting with 'h' still finds it).
        self._index: dict[tuple[str, int], list[str]] = {}
        _confusion_map: dict[str, set[str]] = {}
        for (a, b) in UZBEK_CONFUSIONS:
            _confusion_map.setdefault(a, set()).add(b)

        for word in self.vocabulary:
            c0 = word[0]
            # Register under the word's actual first char and any confused variants
            first_chars = {c0} | _confusion_map.get(c0, set())
            for fc in first_chars:
                key = (fc, len(word))
                if key not in self._index:
                    self._index[key] = []
                self._index[key].append(word)

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def is_correct(self, word: str, _diagnostic: bool = False) -> "bool | str":
        """
        Check if *word* is a known Uzbek word (direct lookup or stem match).

        When *_diagnostic* is True (used only by scripts/extract_roots.py),
        returns a string indicating which path matched:
            "DIRECT"   — word found in vocabulary as-is
            "STEM"     — word was accepted via suffix-stripping
            ""         — word not recognised (falsy)
        """
        w = _normalise_apo(word.lower())
        if w in self.vocabulary and self.word_freq.get(w, 0) >= MIN_DIRECT_FREQ:
            return "DIRECT" if _diagnostic else True
        # Accept agglutinated forms whose stem is a known, frequent word.
        # Gate 3 (vocabulary guard) rejects stems not in the dictionary.
        # The MIN_STEM_FREQ check further rejects low-frequency coincidental
        # matches — e.g. "yiilda" strips to "yiil" (freq=3) which is noise,
        # while "kitobda" strips to "kitob" (freq=12,793) which is real.
        stem = strip_suffix(w, vocabulary=self.vocabulary)
        if (stem != w
                and stem in self.vocabulary
                and self.word_freq.get(stem, 0) >= MIN_STEM_FREQ):
            return "STEM" if _diagnostic else True
        return "" if _diagnostic else False

    def suggest(self, word: str, top_n: int = 3) -> list[str]:
        word = _normalise_apo(word.lower())

        if self.is_correct(word):
            return [word]

        # ── Path 1: Direct candidates from character-bucket index ────────
        # Restrict to words that start with the same first character (or its
        # confusion-pair partner) and are within ±2 characters of query length.
        c0 = word[0]
        target_len = len(word)
        seen: set[str] = set()
        candidates: list[str] = []
        for delta in range(-2, 3):
            for bucket_word in self._index.get((c0, target_len + delta), []):
                if bucket_word not in seen:
                    seen.add(bucket_word)
                    candidates.append(bucket_word)

        # Three-pass scoring:
        #   Pass 1 — rapidfuzz C extension: plain Levenshtein ≤ 2 (fast pre-filter)
        #   Pass 2 — weighted DP on survivors (Uzbek confusion pairs cost 0.5)
        #   Pass 3 — suffix-reconstructed candidates (if Path 1 is thin)
        scored: list[tuple[str, float, int]] = []
        for candidate in candidates:
            if _rfl.distance(word, candidate, score_cutoff=int(_MAX_DIST)) > _MAX_DIST:
                continue
            dist = weighted_distance(word, candidate, cutoff=_MAX_DIST)
            if dist <= _MAX_DIST:
                freq = self.word_freq.get(candidate, 1)
                scored.append((candidate, dist, freq))

        # ── Path 2: Suffix-reconstruct candidates ────────────────────────
        # Always run reconstruction — even when Path 1 found candidates.
        # Queries like "xonaalar" need reconstructed "xonalar" (root "xona"
        # + suffix "lar") to outscore irrelevant Path 1 hits.
        #
        # Example: query "xonaalar" → split as stem "xonaa" + suffix "lar"
        #          → root "xona" (distance 1 from "xonaa")
        #          → reconstruct "xonalar" → score vs "xonaalar" = distance 1
        recon_candidates = self._reconstruct_candidates(word, seen)
        for candidate in recon_candidates:
            if _rfl.distance(word, candidate, score_cutoff=int(_MAX_DIST)) > _MAX_DIST:
                continue
            dist = weighted_distance(word, candidate, cutoff=_MAX_DIST)
            if dist <= _MAX_DIST:
                # Reconstructed form isn't in word_freq directly;
                # use the root's frequency for ranking.
                root = strip_suffix(candidate, vocabulary=self.vocabulary)
                freq = self.word_freq.get(root, 1) if root != candidate else 1
                scored.append((candidate, dist, freq))

        # Primary sort: edit distance. Tiebreak: higher frequency wins.
        scored.sort(key=lambda x: (x[1], -x[2]))
        return [w for w, _, _ in scored[:top_n]]

    def _reconstruct_candidates(
        self, word: str, already_seen: set[str],
    ) -> list[str]:
        """
        Generate correction candidates by splitting *word* at every known
        suffix boundary, finding dictionary roots near the stem portion,
        and yielding ``root + suffix`` reconstructions.

        Only roots with frequency ≥ MIN_STEM_FREQ are accepted, preventing
        low-frequency corpus noise (e.g. 'kord' freq=58) from generating
        phantom reconstructions like 'kordim' that would outrank real
        corrections like 'ko'rdim'.

        The stem→root match uses a tight distance threshold of 1 to keep
        noise low.  The caller re-checks the full reconstruction against
        the original query with ``weighted_distance``, so false positives
        from this stage are filtered out.
        """
        results: list[str] = []
        for suffix in _SORTED_SUFFIXES:
            slen = len(suffix)
            if len(word) < slen + MIN_STEM_LEN:
                continue
            stem_part = word[:-slen]
            sc0 = stem_part[0]
            stem_len = len(stem_part)

            # Scan roots in buckets near the stem's first-char and length.
            # ±1 is enough since we already allow distance-1 stem→root.
            for delta in range(-1, 2):
                bucket = self._index.get((sc0, stem_len + delta))
                if bucket is None:
                    continue
                for root in bucket:
                    # Only accept roots with sufficient frequency to be
                    # legitimate stems — rejects corpus noise.
                    if self.word_freq.get(root, 0) < MIN_STEM_FREQ:
                        continue
                    if _rfl.distance(stem_part, root, score_cutoff=1) <= 1:
                        recon = root + suffix
                        if recon not in already_seen:
                            already_seen.add(recon)
                            results.append(recon)
        return results

    def correct(self, word: str) -> str:
        """Return the single best correction, or the word itself if already correct."""
        suggestions = self.suggest(word, top_n=1)
        return suggestions[0] if suggestions else word

    def check_text(self, text: str) -> dict:
        """
        Spell-check a full Latin-script Uzbek sentence.
        Returns a dict with total word count, error count, and per-error suggestions.
        """
        tokens = word_tokens(text)

        errors = []
        for token in tokens:
            if not self.is_correct(token):
                suggestions = self.suggest(token)
                errors.append({
                    'word': token,
                    'suggestions': suggestions,
                })

        return {
            'total_words': len(tokens),
            'errors_found': len(errors),
            'errors': errors,
        }


# Module-level singleton — avoids reloading the 513k-word dict on every import
_default_checker: UzbekSpellChecker | None = None


def get_checker() -> UzbekSpellChecker:
    global _default_checker
    if _default_checker is None:
        _default_checker = UzbekSpellChecker()
    return _default_checker
