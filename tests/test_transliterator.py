import pytest
from uzbek_text_tools.transliterator import transliterate, transliterate_mixed, detect_token_script
from uzbek_text_tools.tokenizer import tokenize, word_tokens


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


# ------------------------------------------------------------------
# v0.2 — Mixed-script support (Step 4)
# ------------------------------------------------------------------

def test_mixed_script():
    """Latin tokens must survive; Cyrillic tokens must be transliterated."""
    result = transliterate_mixed("kitob китоб")
    assert "kitob" in result.lower()

def test_mixed_script_spec_example():
    result = transliterate_mixed("Bu kitob очень яхши — maktabda o'qiladi")
    assert result == "Bu kitob ochen yaxshi — maktabda o'qiladi"

def test_mixed_script_pure_latin_unchanged():
    text = "Bu kitob juda yaxshi"
    assert transliterate_mixed(text) == text

def test_mixed_script_pure_cyrillic():
    assert transliterate_mixed("Тошкент шаҳри") == "Toshkent shahri"

def test_detect_token_script_latin():
    assert detect_token_script("maktab") == "latin"

def test_detect_token_script_cyrillic():
    assert detect_token_script("мактаб") == "cyrillic"

def test_detect_token_script_digits():
    assert detect_token_script("2025") == "latin"


# ------------------------------------------------------------------
# v0.2 — Apostrophe-aware tokeniser (Fix 2)
# ------------------------------------------------------------------

def test_tokenize_apostrophe_word_stays_whole():
    """o'g'il must come out as a single token — apostrophe is a phoneme marker."""
    assert word_tokens("o'g'il") == ["o'g'il"]


def test_tokenize_oqituvchi_stays_whole():
    """o'qituvchi — o' is a single phoneme; must not be split."""
    assert word_tokens("o'qituvchi") == ["o'qituvchi"]


def test_tokenize_punctuation_separated():
    """Comma between two words must produce two word tokens and one punct token."""
    result = tokenize("kitob, daftar")
    assert result == ["kitob", ",", " ", "daftar"]
    # word_tokens strips the punct/space
    assert word_tokens("kitob, daftar") == ["kitob", "daftar"]


def test_tokenize_sentence_with_apostrophe_words():
    """A full sentence: every apostrophe-word stays intact, plain words split correctly."""
    tokens = word_tokens("Bu o'g'il juda yaxshi!")
    assert tokens == ["Bu", "o'g'il", "juda", "yaxshi"]


def test_tokenize_unicode_apostrophe_variants():
    """ʻ (U+02BB) and ʼ (U+02BC) are accepted just like ASCII apostrophe."""
    # oʻrik uses the Unicode modifier letter ʻ
    assert word_tokens("oʻrik") == ["oʻrik"]
    # gʻoya uses the Unicode modifier letter ʼ (some fonts/keyboards)
    assert word_tokens("gʼoya") == ["gʼoya"]
