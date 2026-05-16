from .transliterator import Transliterator, transliterate
from .spellchecker import UzbekSpellChecker, get_checker
from .pipeline import Pipeline

# Convenience alias
SpellChecker = UzbekSpellChecker

__all__ = ["Transliterator", "transliterate", "UzbekSpellChecker", "SpellChecker", "get_checker", "Pipeline"]
__version__ = "0.1.0"
