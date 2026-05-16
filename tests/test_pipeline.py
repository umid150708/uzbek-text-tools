import pytest
from uzbek_text_tools import UzbekTextPipeline

pipe = UzbekTextPipeline()


# ------------------------------------------------------------------
# Latin input (default)
# ------------------------------------------------------------------

def test_latin_clean_sentence():
    result = pipe.process("Bu kitob juda yaxshi")
    assert result["original"] == "Bu kitob juda yaxshi"
    assert result["converted"] == "Bu kitob juda yaxshi"
    assert result["spell_check"]["errors_found"] == 0


def test_latin_with_typo():
    result = pipe.process("Bu kitoob juda yaxshi")
    errors = result["spell_check"]["errors"]
    misspelled = [e["word"].lower() for e in errors]
    assert "kitoob" in misspelled


def test_latin_suggestion_for_typo():
    result = pipe.process("kitoob")
    error = result["spell_check"]["errors"][0]
    assert "kitob" in error["suggestions"]


# ------------------------------------------------------------------
# Cyrillic input
# ------------------------------------------------------------------

def test_cyrillic_transliterates():
    result = pipe.process("Салом", script="cyrillic")
    assert result["original"] == "Салом"
    assert result["converted"] == "Salom"


def test_cyrillic_correct_sentence_no_errors():
    result = pipe.process("Бу китоб жуда яхши", script="cyrillic")
    assert result["spell_check"]["errors_found"] == 0


def test_cyrillic_typo_detected():
    # Китооб → kitoob after transliteration → flagged as misspelled
    result = pipe.process("Бу китооб жуда яхши", script="cyrillic")
    assert result["spell_check"]["errors_found"] >= 1
    misspelled = [e["word"].lower() for e in result["spell_check"]["errors"]]
    assert "kitoob" in misspelled


def test_cyrillic_example_from_spec():
    # Exact example given in the Phase 4 spec
    result = pipe.process("Бу китооб жуда яхши", script="cyrillic")
    assert result["converted"] == "Bu kitoob juda yaxshi"
    assert result["spell_check"]["errors_found"] >= 1


# ------------------------------------------------------------------
# Return-value structure
# ------------------------------------------------------------------

def test_result_has_required_keys():
    result = pipe.process("salom")
    assert "original" in result
    assert "converted" in result
    assert "spell_check" in result


def test_spell_check_has_required_keys():
    result = pipe.process("salom")
    sc = result["spell_check"]
    assert "total_words" in sc
    assert "errors_found" in sc
    assert "errors" in sc


def test_no_conversion_for_latin_input():
    text = "Oʻzbekiston"
    result = pipe.process(text, script="latin")
    assert result["original"] == result["converted"]
