import pytest
from uzbek_text_tools import SpellChecker


@pytest.fixture
def sc():
    return SpellChecker()


def test_correct_word_is_accepted(sc):
    assert sc.is_correct("salom") is True


def test_unknown_word_is_rejected(sc):
    assert sc.is_correct("xyzabc") is False


def test_suggest_returns_list(sc):
    suggestions = sc.suggest("salm")
    assert isinstance(suggestions, list)


def test_correct_fixes_typo(sc):
    result = sc.correct("salm")
    assert result == "salom"
