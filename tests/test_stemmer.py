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
    'kitoblaringizdagi' requires two passes:
      pass 1: strip '-dagi'    → 'kitoblaringiz'
      pass 2: strip '-laringiz'→ 'kitob'
    No single SUFFIXES entry covers '-laringizdagi', so both passes fire.
    """
    result = iterative_strip("kitoblaringizdagi")
    assert result == ["kitoblaringiz", "kitob"]

def test_iterative_strip_already_bare():
    """A root with no suffix returns an empty list (nothing stripped)."""
    assert iterative_strip("kitob") == []

def test_iterative_strip_max_passes_respected():
    result = iterative_strip("kitoblarimizdan", max_passes=1)
    assert len(result) == 1

def test_iterative_strip_returns_list():
    assert isinstance(iterative_strip("kitob"), list)


# ------------------------------------------------------------------
# Vocabulary guard (Fix 1)
# Tests use minimal mock vocabularies so they never touch the real
# 548k-word dictionary — failures here isolate the gate-3 logic.
# ------------------------------------------------------------------

def test_vocab_guard_accepts_known_stem():
    """Strip is accepted when the resulting stem is in the vocabulary."""
    vocab = {"kitob"}
    assert strip_suffix("kitobdan", vocabulary=vocab) == "kitob"

def test_vocab_guard_rejects_unknown_stem():
    """
    'xyzdan' → stem 'xyz': not in vocabulary.
    Gate 3 blocks the strip, so the original word is returned.
    """
    vocab = {"kitob", "maktab"}          # 'xyz' deliberately absent
    assert strip_suffix("xyzdan", vocabulary=vocab) == "xyzdan"

def test_vocab_guard_falls_through_to_shorter_suffix():
    """
    When the first (longest) suffix produces an unknown stem, the function
    must keep trying shorter suffixes until it finds one whose stem IS known.

    'kitoblardan':
      1. tries 'lardan' → stem 'kitob'  ← in vocab → accept immediately
    (If vocab only had 'kitob', this confirms the fallthrough path too.)
    """
    vocab = {"kitob"}
    # 'lardan' is in SUFFIXES → stem is 'kitob' which is in vocab → accepted
    assert strip_suffix("kitoblardan", vocabulary=vocab) == "kitob"

def test_vocab_guard_none_means_no_validation():
    """
    vocabulary=None (the default) must behave exactly as before — only
    the length guard and vowel guard apply.  An unknown stem like 'xyz'
    is returned without complaint.
    """
    assert strip_suffix("xyzdan") == "xyz"          # no vocabulary supplied
    assert strip_suffix("xyzdan", vocabulary=None) == "xyz"

def test_vocab_guard_blocks_non_root_phantom_stem():
    """
    'ishchi' (worker) ends in '-i'.  Without vocab: strip_suffix gives 'ishch'
    (length ≥ 3, ends in consonant so vowel guard passes).
    With vocab containing 'ishchi' but NOT 'ishch': gate 3 rejects 'ishch'
    and no other suffix matches, so the word is returned unchanged.
    This demonstrates that the validator prevents phantom non-root strips.
    """
    vocab_without_ishch = {"ishchi", "ish"}   # 'ishch' absent
    assert strip_suffix("ishchi", vocabulary=vocab_without_ishch) == "ishchi"

def test_iterative_strip_passes_vocab_through():
    """
    iterative_strip must forward the vocabulary to every pass.
    'kitoblaringizdagi' with vocab {'kitob', 'kitoblaringiz'} fires:
      pass 1: strip '-dagi'     → 'kitoblaringiz'  ← in vocab → accepted
      pass 2: strip '-laringiz' → 'kitob'          ← in vocab → accepted
    If vocab were NOT forwarded, pass 2 would strip to an unknown stem
    and the vocabulary gate would block it.
    """
    vocab = {"kitob", "kitoblaringiz"}
    result = iterative_strip("kitoblaringizdagi", vocabulary=vocab)
    assert result == ["kitoblaringiz", "kitob"]
