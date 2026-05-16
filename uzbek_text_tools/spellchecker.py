import re

from .stemmer import strip_suffix
from .data_loader import load_dictionary

# Uzbek Latin word tokeniser — covers apostrophe letters ʻ ʼ and digraphs
TOKEN_RE = re.compile(r"[a-zA-ZʻʼoOgG']+")

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
}


_MAX_DIST = 2.0   # suggest() threshold — used for early exit


def weighted_distance(a: str, b: str, cutoff: float = _MAX_DIST) -> float:
    """
    Levenshtein distance with reduced substitution cost for known Uzbek
    letter confusions (see UZBEK_CONFUSIONS).  Insertions and deletions
    still cost 1.0.

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
    prev = [float(j) for j in range(n + 1)]

    for i in range(1, m + 1):
        curr = [float(i)] + [0.0] * n
        row_min = curr[0]

        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                cost = 0.0
            else:
                cost = UZBEK_CONFUSIONS.get((a[i - 1], b[j - 1]), 1.0)

            curr[j] = min(
                prev[j] + 1.0,          # deletion
                curr[j - 1] + 1.0,      # insertion
                prev[j - 1] + cost,     # substitution
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
        self.word_freq: dict[str, int] = load_dictionary()
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

    def is_correct(self, word: str) -> bool:
        w = word.lower()
        if w in self.vocabulary:
            return True
        # Accept agglutinated forms whose stem is a known, frequent word.
        # Gate 3 (vocabulary guard) rejects stems not in the dictionary.
        # The MIN_STEM_FREQ check further rejects low-frequency coincidental
        # matches — e.g. "yiilda" strips to "yiil" (freq=3) which is noise,
        # while "kitobda" strips to "kitob" (freq=12,793) which is real.
        stem = strip_suffix(w, vocabulary=self.vocabulary)
        if (stem != w
                and stem in self.vocabulary
                and self.word_freq.get(stem, 0) >= MIN_STEM_FREQ):
            return True
        return False

    def suggest(self, word: str, top_n: int = 3) -> list[str]:
        word = word.lower()

        if self.is_correct(word):
            return [word]

        # Use the character-bucket index to restrict candidates to words that:
        #   • start with the same first character (or its confusion-pair partner)
        #   • are within ±2 characters of the query length
        # This reduces the candidate pool by ~10–20× vs a plain length filter.
        c0 = word[0]
        target_len = len(word)
        seen: set[str] = set()
        candidates: list[str] = []
        for delta in range(-2, 3):           # lengths: target-2 … target+2
            for bucket_word in self._index.get((c0, target_len + delta), []):
                if bucket_word not in seen:
                    seen.add(bucket_word)
                    candidates.append(bucket_word)

        scored = []
        for candidate in candidates:
            dist = weighted_distance(word, candidate, cutoff=_MAX_DIST)
            if dist <= _MAX_DIST:
                freq = self.word_freq.get(candidate, 1)
                scored.append((candidate, dist, freq))

        # Primary sort: edit distance. Tiebreak: higher frequency wins.
        scored.sort(key=lambda x: (x[1], -x[2]))
        return [w for w, _, _ in scored[:top_n]]

    def correct(self, word: str) -> str:
        """Return the single best correction, or the word itself if already correct."""
        suggestions = self.suggest(word, top_n=1)
        return suggestions[0] if suggestions else word

    def check_text(self, text: str) -> dict:
        """
        Spell-check a full Latin-script Uzbek sentence.
        Returns a dict with total word count, error count, and per-error suggestions.
        """
        tokens = TOKEN_RE.findall(text)

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
