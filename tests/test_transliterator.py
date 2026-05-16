import pytest
from uzbek_text_tools import Transliterator


@pytest.fixture
def t():
    return Transliterator()


def test_cyrillic_to_latin_basic(t):
    assert t.cyrillic_to_latin("Салом") == "Salom"


def test_cyrillic_to_latin_roundtrip(t):
    original = "Ўзбекистон"
    latin = t.cyrillic_to_latin(original)
    assert len(latin) > 0


def test_latin_preserves_non_uzbek(t):
    assert t.cyrillic_to_latin("hello") == "hello"
