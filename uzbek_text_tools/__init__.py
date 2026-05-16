from .transliterator import Transliterator, transliterate
from .spellchecker import UzbekSpellChecker, get_checker
from .pipeline import UzbekTextPipeline

# Convenience aliases
SpellChecker = UzbekSpellChecker
Pipeline = UzbekTextPipeline

__all__ = [
    "Transliterator", "transliterate",
    "UzbekSpellChecker", "SpellChecker", "get_checker",
    "UzbekTextPipeline", "Pipeline",
]
__version__ = "0.1.0"
