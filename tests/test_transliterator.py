import pytest
from uzbek_text_tools.transliterator import transliterate


def test_simple_word():
    assert transliterate("салом") == "salom"


def test_uppercase():
    assert transliterate("САЛОМ") == "SALOM"


def test_sh_mapping():
    assert transliterate("шаҳар") == "shahar"


def test_ch_mapping():
    assert transliterate("чой") == "choy"


def test_numbers_preserved():
    assert transliterate("2025 йил") == "2025 yil"


def test_punctuation_preserved():
    assert transliterate("салом, дўст!") == "salom, doʻst!"


def test_ye_at_word_start():
    # Е at beginning of word → Ye
    assert transliterate("Европа") == "Yevropa"


def test_e_in_middle():
    # е in the middle of a word → e (not ye)
    assert transliterate("метро") == "metro"


def test_yo_mapping():
    assert transliterate("ёз") == "yoz"


def test_yu_mapping():
    assert transliterate("юрт") == "yurt"


def test_ya_mapping():
    assert transliterate("яхши") == "yaxshi"


def test_gh_special():
    assert transliterate("ғалла") == "gʻalla"


def test_ow_special():
    assert transliterate("ўрик") == "oʻrik"


def test_q_mapping():
    assert transliterate("қўл") == "qoʻl"


def test_ng_digraph():
    assert transliterate("нг") == "ng"


def test_mixed_sentence():
    assert transliterate("Ўзбекистон — буюк давлат.") == "Oʻzbekiston — buyuk davlat."
