"""
Unit tests for uzbek_text_tools.stemmer.

Covers strip_suffix() directly — independent of the dictionary — so failures
here pinpoint the stemming logic rather than a missing vocabulary entry.
"""
from uzbek_text_tools.stemmer import strip_suffix, iterative_strip, MIN_STEM_LEN


# ------------------------------------------------------------------
# strip_suffix — basic suffix removal
# ------------------------------------------------------------------

def test_strip_plural():
    assert strip_suffix("kitoblar") == "kitob"

def test_strip_dative():
    assert strip_suffix("kitobga") == "kitob"

def test_strip_locative():
    assert strip_suffix("kitobda") == "kitob"

def test_strip_ablative():
    assert strip_suffix("kitobdan") == "kitob"

def test_strip_genitive():
    assert strip_suffix("kitobning") == "kitob"

def test_strip_long_stack():
    """Longest suffix wins — 'larimizdan' (10 chars) beats 'dan' (3 chars)."""
    assert strip_suffix("kitoblarimizdan") == "kitob"

def test_strip_dagi():
    assert strip_suffix("maktabdagi") == "maktab"

def test_no_suffix_returns_word():
    """Words with no matching suffix come back unchanged."""
    assert strip_suffix("kitob") == "kitob"

def test_garbage_returns_unchanged():
    assert strip_suffix("xyzzzq") == "xyzzzq"

def test_min_stem_length_respected():
    """Stripping that would leave fewer than MIN_STEM_LEN chars is rejected."""
    # 'da' suffix on a 4-char word → 2-char stem → rejected
    short = "ab" + "da"       # "abda" → stem "ab" (len 2) — should be blocked
    assert strip_suffix(short) == short

def test_min_stem_length_boundary():
    """Exactly MIN_STEM_LEN chars is accepted."""
    # 3-char stem + "dan"
    word = "a" * MIN_STEM_LEN + "dan"
    assert strip_suffix(word) == "a" * MIN_STEM_LEN


# ------------------------------------------------------------------
# strip_suffix — vowel guard for bare -i suffix
# ------------------------------------------------------------------

def test_i_suffix_on_consonant_stem():
    """Root ending in consonant: bare -i is a valid possessive."""
    assert strip_suffix("kitobi") == "kitob"

def test_i_suffix_blocked_on_vowel_stem():
    """'yaxshii' must not strip — stem 'yaxshi' ends in a vowel."""
    assert strip_suffix("yaxshii") == "yaxshii"


# ------------------------------------------------------------------
# iterative_strip
# ------------------------------------------------------------------

def test_iterative_strip_two_passes():
    """
    'kitoblarim' (my books) takes two rounds:
      pass 1: strip '-im'  → 'kitoblar'
      pass 2: strip '-lar' → 'kitob'
    Combined 'larim' is not a single SUFFIXES entry, so both passes fire.
    """
    result = iterative_strip("kitoblarim")
    assert result == ["kitoblar", "kitob"]

def test_iterative_strip_already_bare():
    """A root with no suffix returns an empty list (nothing stripped)."""
    assert iterative_strip("kitob") == []

def test_iterative_strip_max_passes_respected():
    result = iterative_strip("kitoblarimizdan", max_passes=1)
    assert len(result) == 1

def test_iterative_strip_returns_list():
    assert isinstance(iterative_strip("kitob"), list)
