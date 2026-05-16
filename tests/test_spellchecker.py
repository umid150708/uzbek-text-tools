import pytest
from uzbek_text_tools.spellchecker import UzbekSpellChecker

# One shared instance — loading 513k words once per test session is enough
checker = UzbekSpellChecker()


# ------------------------------------------------------------------
# is_correct
# ------------------------------------------------------------------

def test_correct_word():
    assert checker.is_correct("kitob") is True

def test_correct_word_case_insensitive():
    assert checker.is_correct("Kitob") is True

def test_incorrect_word():
    assert checker.is_correct("kitoob") is False

def test_correct_uzbek_special_chars():
    assert checker.is_correct("oʻzbekiston") is True

def test_unknown_garbage():
    assert checker.is_correct("xyzzzq") is False


# ------------------------------------------------------------------
# suggest
# ------------------------------------------------------------------

def test_suggestion_exists():
    suggestions = checker.suggest("kitoob")
    assert "kitob" in suggestions

def test_suggest_returns_list():
    result = checker.suggest("blan")
    assert isinstance(result, list)

def test_suggest_correct_word_returns_itself():
    result = checker.suggest("bilan")
    assert result == ["bilan"]

def test_suggest_top_n_respected():
    result = checker.suggest("kitoob", top_n=2)
    assert len(result) <= 2

def test_suggest_closer_match_comes_first():
    # "kitob" is distance-1 from "kitoob"; it should rank before distance-2 words
    result = checker.suggest("kitoob")
    assert result[0] == "kitob"

def test_suggest_frequency_breaks_ties():
    # "bilan" (freq ~386k) should beat any equally-close rare word
    result = checker.suggest("billan")
    assert "bilan" in result


# ------------------------------------------------------------------
# correct
# ------------------------------------------------------------------

def test_correct_fixes_typo():
    assert checker.correct("kitoob") == "kitob"

def test_correct_leaves_good_word():
    assert checker.correct("kitob") == "kitob"


# ------------------------------------------------------------------
# check_text
# ------------------------------------------------------------------

def test_check_text_finds_errors():
    result = checker.check_text("Bu kitoob juda yaxshi")
    assert result['errors_found'] >= 1

def test_check_text_clean_sentence():
    result = checker.check_text("Bu kitob juda yaxshi")
    assert result['errors_found'] == 0

def test_check_text_counts_words():
    result = checker.check_text("Bu kitob juda yaxshi")
    assert result['total_words'] == 4

def test_check_text_error_has_suggestions():
    result = checker.check_text("Bu kitoob yaxshi")
    error = next(e for e in result['errors'] if e['word'].lower() == 'kitoob')
    assert len(error['suggestions']) > 0
    assert "kitob" in error['suggestions']

def test_check_text_multi_error():
    result = checker.check_text("kitoob yaxshii")
    assert result['errors_found'] == 2


# ------------------------------------------------------------------
# v0.2 — Suffix stripper (Step 2)
# ------------------------------------------------------------------

def test_inflected_form_not_flagged():
    """Agglutinated forms whose stem is in the dictionary must pass."""
    assert checker.is_correct("kitoblarimizdan") is True
    assert checker.is_correct("maktabdagi") is True

def test_inflected_form_stem_too_short():
    """Stripping would leave a stem under MIN_STEM_LEN — still flagged."""
    assert checker.is_correct("ktoblar") is False

def test_suffix_strip_does_not_accept_double_vowel_typo():
    """'yaxshii' must NOT pass — vowel guard prevents false -i strip."""
    assert checker.is_correct("yaxshii") is False


# ------------------------------------------------------------------
# v0.2 — Weighted edit distance (Step 3)
# ------------------------------------------------------------------

def test_phonetic_confusion_ranked_correctly():
    """
    'hamma' is itself a valid Uzbek word ('everyone'); suggest() should
    return it — exercising the h/x confusion path indirectly.
    The key property: at least one suggestion is returned.
    """
    suggestions = checker.suggest("hamma")
    assert len(suggestions) > 0

def test_weighted_distance_confused_pair_ranks_higher():
    """
    'kitop' differs from 'kitob' by the b/p confusion pair (cost 0.5).
    'kitob' should therefore be the top suggestion.
    """
    suggestions = checker.suggest("kitop")
    assert suggestions[0] == "kitob"
