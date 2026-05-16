from .transliterator import (
    Transliterator, transliterate,
    detect_token_script, transliterate_mixed,
)
from .spellchecker import UzbekSpellChecker, get_checker
from .pipeline import UzbekTextPipeline

# Convenience aliases
SpellChecker = UzbekSpellChecker
Pipeline = UzbekTextPipeline

__all__ = [
    "Transliterator", "transliterate",
    "detect_token_script", "transliterate_mixed",
    "UzbekSpellChecker", "SpellChecker", "get_checker",
    "UzbekTextPipeline", "Pipeline",
]
__version__ = "0.2.0"
