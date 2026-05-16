import json
import os
import re

from Levenshtein import distance as lev_distance

DATA_PATH = os.path.join(os.path.dirname(__file__), 'data', 'word_freq.json')

# Uzbek Latin word tokeniser — covers apostrophe letters ʻ ʼ and digraphs
TOKEN_RE = re.compile(r"[a-zA-ZʻʼoOgG']+")


class UzbekSpellChecker:
    def __init__(self, dictionary_path: str = DATA_PATH):
        with open(dictionary_path, 'r', encoding='utf-8') as f:
            self.word_freq: dict[str, int] = json.load(f)
        self.vocabulary: set[str] = set(self.word_freq.keys())

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def is_correct(self, word: str) -> bool:
        return word.lower() in self.vocabulary

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
            dist = lev_distance(word, candidate)
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
