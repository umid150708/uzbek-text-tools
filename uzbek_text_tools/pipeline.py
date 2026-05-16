from .transliterator import transliterate
from .spellchecker import UzbekSpellChecker


class UzbekTextPipeline:
    """
    One-call interface: optional Cyrillic→Latin transliteration followed by
    full spell-check with per-word suggestions.
    """

    def __init__(self):
        self.checker = UzbekSpellChecker()

    def process(self, text: str, script: str = "latin") -> dict:
        """
        Args:
            text:   Input Uzbek text (Latin or Cyrillic).
            script: "cyrillic" — transliterate first, then spellcheck.
                    "latin"    — spellcheck directly (default).
        Returns:
            {
                "original":    original input text,
                "converted":   Latin-script text after optional transliteration,
                "spell_check": {
                    "total_words": int,
                    "errors_found": int,
                    "errors": [{"word": str, "suggestions": [str, ...]}, ...]
                }
            }
        """
        if script == "cyrillic":
            converted_text = transliterate(text)
        else:
            converted_text = text

        spell_result = self.checker.check_text(converted_text)

        return {
            "original": text,
            "converted": converted_text,
            "spell_check": spell_result,
        }
