import json
from pathlib import Path
from Levenshtein import distance


class SpellChecker:
    """Uzbek spellchecker using edit-distance against a frequency dictionary."""

    def __init__(self, dictionary_path: str | None = None):
        if dictionary_path is None:
            dictionary_path = Path(__file__).parent / "data" / "word_freq.json"
        with open(dictionary_path, "r", encoding="utf-8") as f:
            self.word_freq: dict[str, int] = json.load(f)
        self.vocab = list(self.word_freq.keys())

    def is_correct(self, word: str) -> bool:
        return word.lower() in self.word_freq

    def suggest(self, word: str, n: int = 5, max_distance: int = 2) -> list[str]:
        word = word.lower()
        candidates = [
            (w, distance(word, w))
            for w in self.vocab
            if abs(len(w) - len(word)) <= max_distance
        ]
        candidates = [(w, d) for w, d in candidates if d <= max_distance]
        candidates.sort(key=lambda x: (x[1], -self.word_freq.get(x[0], 0)))
        return [w for w, _ in candidates[:n]]

    def correct(self, word: str) -> str:
        if self.is_correct(word):
            return word
        suggestions = self.suggest(word, n=1)
        return suggestions[0] if suggestions else word
