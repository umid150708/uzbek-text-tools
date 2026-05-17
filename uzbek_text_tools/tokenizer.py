"""
uzbek_text_tools.tokenizer
~~~~~~~~~~~~~~~~~~~~~~~~~~
Apostrophe-aware tokeniser for Uzbek Latin script.

The Uzbek Latin alphabet uses the apostrophe character as part of two
distinct phonemes:

    o'  (oʻ)  — rounded back vowel, Unicode MODIFIER LETTER TURNED COMMA ʻ
    g'  (gʻ)  — voiced velar fricative, Unicode MODIFIER LETTER APOSTROPHE ʼ

Both the ASCII apostrophe (U+0027) and the Unicode modifier letters
ʻ (U+02BB) and ʼ (U+02BC) are accepted interchangeably.  The tokeniser
guarantees that these characters are **never** split away from the letter
they follow when that letter is part of a word:

    o'g'il      → one token  ['o'g'il']
    o'qituvchi  → one token  ['o'qituvchi']
    kitob, do'st → tokens   ['kitob', ',', ' ', "do'st"]

Token types
-----------
WORD    A sequence that starts with an ASCII/Latin letter and may contain
        further letters or apostrophe characters.  This covers plain words
        (kitob), words with one apostrophe-phoneme (o'rik, g'oya), and
        words with several (o'g'il).

PUNCT   A single non-whitespace, non-word character (comma, full stop,
        dash, digit-only tokens are *not* emitted as WORD).

SPACE   A run of one or more whitespace characters (preserved so that
        joining the token list reconstructs the original string).

Public API
----------
tokenize(text)      → list[str]   all tokens (WORD + PUNCT + SPACE)
word_tokens(text)   → list[str]   WORD tokens only (for spell-checking)
"""

import re

# All apostrophe variants used in Uzbek Latin writing
_APO = r"'ʻʼ"   # ASCII ' · ʻ (U+02BB) · ʼ (U+02BC)

# Master pattern — order matters: longest / most-specific alternative first.
#   1. WORD  — must start with a Latin letter; may continue with letters or
#              any of the three apostrophe characters (so o'g'il is one token).
#   2. PUNCT — single character that is neither whitespace nor a \w char.
#   3. SPACE — one or more whitespace characters.
_TOKEN_RE = re.compile(
    rf"[a-zA-Z][a-zA-Z{_APO}]*"  # WORD
    r"|[^\w\s]"                    # PUNCT
    r"|\s+"                        # SPACE
)

# A compiled pattern used by word_tokens() to identify WORD tokens
# (starts with a Latin letter).
_WORD_START = re.compile(r"^[a-zA-Z]")


def tokenize(text: str) -> list[str]:
    """
    Split *text* into a flat list of surface tokens.

    Joining the returned list with ``""`` reproduces the original string
    exactly (for well-formed Uzbek Latin input).

    Examples
    --------
    >>> tokenize("o'g'il yaxshi!")
    ["o'g'il", ' ', 'yaxshi', '!']

    >>> tokenize("kitob, daftar")
    ['kitob', ',', ' ', 'daftar']
    """
    return _TOKEN_RE.findall(text)


def word_tokens(text: str) -> list[str]:
    """
    Return only the WORD tokens from *text* — no punctuation, no whitespace.

    This is the function used by the spell-checker; it correctly keeps
    apostrophe-phoneme words (o'rik, g'oya, o'g'il) as single tokens.

    Examples
    --------
    >>> word_tokens("Bu o'g'il juda yaxshi!")
    ['Bu', "o'g'il", 'juda', 'yaxshi']
    """
    return [t for t in _TOKEN_RE.findall(text) if _WORD_START.match(t)]
