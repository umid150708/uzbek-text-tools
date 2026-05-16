"""
Rule-based Uzbek suffix stripper.

Uzbek is agglutinative — a single root can carry many suffixes stacked
together. This module strips the outermost suffix iteratively until a
known vocabulary stem is found (or the original word is returned unchanged).

Suffixes are tried longest-first so that "larimizdan" is matched whole
before its sub-suffixes like "dan" or "lar" are attempted individually.
"""

# Ordered from longest to shortest at definition time.
# strip_suffix() re-sorts by length anyway, but keeping them grouped
# here makes the list easier to extend.
SUFFIXES = [
    # Plural + possessive + case stacks
    "larimizdan", "larimizga",  "larimizni",  "larimiz",
    "laringizdan","laringizga", "laringizni", "laringiz",
    "larингizdan",
    "imizdagi",
    "laridan",    "lariga",     "larini",     "larda",
    "lardan",     "larni",      "larga",
    "imizdan",    "imizga",     "imizni",     "imiz",
    "ingizdan",   "ingizga",    "ingizni",    "ingiz",
    # Single-level case/possessive suffixes
    "dagi",       "ning",       "dan",        "idan",
    "ga",         "da",         "ni",         "lar",
    "im",         "ing",        "i",
]

# Pre-sorted once at import time — avoids re-sorting on every call
_SORTED_SUFFIXES = sorted(SUFFIXES, key=len, reverse=True)

MIN_STEM_LEN = 3  # don't accept a stem shorter than this

# The bare possessive suffix "i" is only valid on consonant-final stems.
# If the stem itself ends in a vowel the suffix is a false match
# (e.g. "yaxshii" → stem "yaxshi" ends in 'i' → reject).
_VOWELS = frozenset("aeiouoʻ")


def strip_suffix(word: str) -> str:
    """
    Remove the longest matching suffix from *word* and return the stem.
    Returns *word* unchanged if no suffix matches or the resulting stem
    would be shorter than MIN_STEM_LEN characters.

    Special rule: the single-character suffix ``i`` is only stripped when
    the resulting stem ends in a consonant (Uzbek morphology — the 3rd-person
    possessive ``-i`` attaches to consonant-final roots only).
    """
    for suffix in _SORTED_SUFFIXES:
        if word.endswith(suffix):
            stem = word[: -len(suffix)]
            if len(stem) < MIN_STEM_LEN:
                continue
            # Vowel guard for the bare -i suffix
            if suffix == "i" and stem[-1] in _VOWELS:
                continue
            return stem
    return word


def iterative_strip(word: str, max_passes: int = 3) -> list[str]:
    """
    Strip suffixes up to *max_passes* times, returning every intermediate
    stem. Useful for deeply agglutinated forms like 'kitoblarimizgacha'.

    Returns a list of candidates in order from longest-stripped to shortest:
        ['kitoblarimizga', 'kitoblarimiz', 'kitoblar', 'kitob']
    """
    candidates: list[str] = []
    current = word
    for _ in range(max_passes):
        stripped = strip_suffix(current)
        if stripped == current:
            break
        candidates.append(stripped)
        current = stripped
    return candidates
