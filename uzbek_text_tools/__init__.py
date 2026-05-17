from .transliterator import (
    Transliterator, transliterate,
    detect_token_script, transliterate_mixed,
)
from .spellchecker import UzbekSpellChecker, get_checker
from .pipeline import UzbekTextPipeline
from .tokenizer import tokenize, word_tokens

# Convenience aliases
SpellChecker = UzbekSpellChecker
Pipeline = UzbekTextPipeline

__all__ = [
    "Transliterator", "transliterate",
    "detect_token_script", "transliterate_mixed",
    "UzbekSpellChecker", "SpellChecker", "get_checker",
    "UzbekTextPipeline", "Pipeline",
    "tokenize", "word_tokens",
]
__version__ = "0.2.0"
