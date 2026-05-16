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


def weighted_distance(a: str, b: str) -> float:
    """
    Levenshtein distance with reduced substitution cost for known Uzbek
    letter confusions (see UZBEK_CONFUSIONS).  Insertions and deletions
    still cost 1.0.
    """
    m, n = len(a), len(b)
    # dp[i][j] = min cost to turn a[:i] into b[:j]
    dp = [[0.0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = float(i)
    for j in range(n + 1):
        dp[0][j] = float(j)

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                cost = 0.0
            else:
                cost = UZBEK_CONFUSIONS.get((a[i - 1], b[j - 1]), 1.0)
            dp[i][j] = min(
                dp[i - 1][j] + 1.0,        # deletion
                dp[i][j - 1] + 1.0,        # insertion
                dp[i - 1][j - 1] + cost,   # substitution
            )
    return dp[m][n]


class UzbekSpellChecker:
    def __init__(self):
        self.word_freq: dict[str, int] = load_dictionary()
        self.vocabulary: set[str] = set(self.word_freq.keys())

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def is_correct(self, word: str) -> bool:
        w = word.lower()
        if w in self.vocabulary:
            return True
        # Accept agglutinated forms whose stem is a known word.
        # Passing self.vocabulary activates the vocabulary guard inside
        # strip_suffix, so only genuine dictionary roots are accepted.
        stem = strip_suffix(w, vocabulary=self.vocabulary)
        if stem != w and stem in self.vocabulary:
            return True
        return False

    def suggest(self, word: str, top_n: int = 3) -> list[str]:
        word = word.lower()

        if self.is_correct(word):
            return [word]

        # Length-window filter: only compare words within ±2 characters
        candidates = [
            w for w in self.vocabulary
            if abs(len(w) - len(word)) <= 2
        ]

        scored = []
        for candidate in candidates:
            dist = weighted_distance(word, candidate)
            if dist <= 2:
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
