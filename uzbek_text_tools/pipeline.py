from .transliterator import Transliterator
from .spellchecker import UzbekSpellChecker


class Pipeline:
    """End-to-end Uzbek text processing: transliterate then spellcheck."""

    def __init__(self, dictionary_path: str | None = None):
        self.transliterator = Transliterator()
        kwargs = {"dictionary_path": dictionary_path} if dictionary_path else {}
        self.spellchecker = UzbekSpellChecker(**kwargs)

    def process(self, text: str, script: str = "latin") -> dict:
        """
        Args:
            text: Input Uzbek text.
            script: 'latin' or 'cyrillic' — target script for transliteration.
        Returns dict with transliterated text and per-word corrections.
        """
        if script == "latin":
            transliterated = self.transliterator.cyrillic_to_latin(text)
        else:
            transliterated = self.transliterator.latin_to_cyrillic(text)

        words = transliterated.split()
        corrections = {}
        for word in words:
            clean = word.strip(".,!?;:\"'")
            if not self.spellchecker.is_correct(clean):
                suggestion = self.spellchecker.correct(clean)
                if suggestion != clean:
                    corrections[word] = suggestion

        return {"transliterated": transliterated, "corrections": corrections}
