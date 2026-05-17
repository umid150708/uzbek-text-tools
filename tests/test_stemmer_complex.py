"""
Deeply-stacked Uzbek suffix forms — 20 test cases.

All chains are derived from Apertium's FULL-NOMINAL-INFLECTION paradigm:
    PLURAL(lar) + POSSESSIVE(im/ing/imiz/ingiz/i) + CASE(da/dan/ga/ni/ning)

The vocabulary used below is a small fixed set so tests run without loading
the full 548k-word dictionary.  strip_suffix() accepts a vocabulary= keyword;
passing it in here keeps tests fast and self-contained.
"""

import pytest
from uzbek_text_tools.stemmer import strip_suffix, iterative_strip

# Minimal vocabulary shared by all tests
VOCAB = frozenset({
    "kitob",     # book
    "maktab",    # school
    "davlat",    # state
    "shahar",    # city
    "do'st",     # friend
    "uy",        # house
    "ko'cha",    # street
    "xona",      # room
    "qo'l",      # hand
    "oyoq",      # foot
    "yil",       # year
    "kun",       # day
    "ish",       # work
    "narsa",     # thing
    "ota",       # father
})


# ---------------------------------------------------------------------------
# lar + imiz + case  (1st-person plural possessive on plural stem)
# ---------------------------------------------------------------------------

def test_larimizda_strips_to_root():
    # kitoblarimizda → kitob  (in our books)
    assert strip_suffix("kitoblarimizda", vocabulary=VOCAB) == "kitob"

def test_larimizdan_strips_to_root():
    # maktablarimizdan → maktab  (from our schools)
    assert strip_suffix("maktablarimizdan", vocabulary=VOCAB) == "maktab"

def test_larimizga_strips_to_root():
    # kitoblarimizga → kitob  (to our books)
    assert strip_suffix("kitoblarimizga", vocabulary=VOCAB) == "kitob"

def test_larimizni_strips_to_root():
    # kitoblarimizni → kitob  (our books, accusative)
    assert strip_suffix("kitoblarimizni", vocabulary=VOCAB) == "kitob"

def test_larimizning_strips_to_root():
    # kitoblarimizning → kitob  (of our books, genitive)
    assert strip_suffix("kitoblarimizning", vocabulary=VOCAB) == "kitob"


# ---------------------------------------------------------------------------
# lar + ingiz + case  (2nd-person formal plural possessive)
# ---------------------------------------------------------------------------

def test_laringizdan_strips_to_root():
    # davlatlaringizdan → davlat  (from your states)
    assert strip_suffix("davlatlaringizdan", vocabulary=VOCAB) == "davlat"

def test_laringizga_strips_to_root():
    # kitoblaringizga → kitob
    assert strip_suffix("kitoblaringizga", vocabulary=VOCAB) == "kitob"

def test_laringizda_strips_to_root():
    # shaharlariingizda — locative; use regular form
    assert strip_suffix("kitoblaringizda", vocabulary=VOCAB) == "kitob"

def test_laringizning_strips_to_root():
    # kitoblaringizning → kitob
    assert strip_suffix("kitoblaringizning", vocabulary=VOCAB) == "kitob"


# ---------------------------------------------------------------------------
# lar + im + case  (1st-person singular possessive)
# ---------------------------------------------------------------------------

def test_larimdan_strips_to_root():
    # kitoblarimdan → kitob  (from my books)
    assert strip_suffix("kitoblarimdan", vocabulary=VOCAB) == "kitob"

def test_larimga_strips_to_root():
    # kitoblarimga → kitob
    assert strip_suffix("kitoblarimga", vocabulary=VOCAB) == "kitob"

def test_larimni_strips_to_root():
    assert strip_suffix("kitoblarimni", vocabulary=VOCAB) == "kitob"

def test_larimda_strips_to_root():
    assert strip_suffix("kitoblarimda", vocabulary=VOCAB) == "kitob"

def test_larimning_strips_to_root():
    assert strip_suffix("kitoblarimning", vocabulary=VOCAB) == "kitob"


# ---------------------------------------------------------------------------
# lar + ing + case  (2nd-person singular possessive)
# ---------------------------------------------------------------------------

def test_laringdan_strips_to_root():
    assert strip_suffix("maktablaringdan", vocabulary=VOCAB) == "maktab"

def test_laringga_strips_to_root():
    assert strip_suffix("maktablaringga", vocabulary=VOCAB) == "maktab"

def test_laringda_strips_to_root():
    assert strip_suffix("maktablaringda", vocabulary=VOCAB) == "maktab"


# ---------------------------------------------------------------------------
# lar + i + dagi  (3rd-person possessive + locative attributive)
# ---------------------------------------------------------------------------

def test_laridagi_strips_to_root():
    # "lardagi" = lar+dagi (in the cities); "laridagi" = lar+i+dagi (in their cities)
    # Both must strip to the root.
    assert strip_suffix("shaharlardagi",  vocabulary=VOCAB) == "shahar"  # lardagi
    assert strip_suffix("kitoblaridagi",  vocabulary=VOCAB) == "kitob"   # laridagi


# ---------------------------------------------------------------------------
# Single possessive + case
# ---------------------------------------------------------------------------

def test_imizda_strips_to_root():
    # kitobimizda → kitob  (in our book)
    assert strip_suffix("kitobimizda", vocabulary=VOCAB) == "kitob"

def test_ingizdan_strips_to_root():
    # kitobingizdan → kitob  (from your book, formal)
    assert strip_suffix("kitobingizdan", vocabulary=VOCAB) == "kitob"
