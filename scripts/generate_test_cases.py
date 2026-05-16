"""
Step 1 — Generate benchmark test cases programmatically.

Produces two categories:
  • phonetic  — apply one known Uzbek confusion-pair substitution
  • double_char — double a vowel or consonant (most common casual typing error)

100 cases of each type are written to data/benchmark.json.
Real-user typos (type="real") are pre-seeded in this script — add more
after collecting them from native speakers.

Usage:
    python scripts/generate_test_cases.py

Output: uzbek_text_tools/data/benchmark.json
"""
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from uzbek_text_tools import UzbekSpellChecker

OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "uzbek_text_tools", "data", "benchmark.json")

# Same confusion pairs as in spellchecker.py UZBEK_CONFUSIONS
CONFUSIONS = [
    ("x", "h"), ("h", "x"),
    ("b", "p"), ("p", "b"),
    ("d", "t"), ("t", "d"),
    ("i", "y"), ("y", "i"),
    ("u", "o"), ("o", "u"),
]

# Only double vowels (consonant-doubling is less common in Uzbek typing errors)
VOWELS = set("aeiou")

# ---------------------------------------------------------------------------
# Typo generators
# ---------------------------------------------------------------------------

def make_phonetic_typo(word: str) -> tuple[str, str] | None:
    """
    Apply the FIRST matching confusion-pair substitution and return
    (typo, correct_word).  Returns None if no confusion pair applies.
    """
    for i, char in enumerate(word):
        for a, b in CONFUSIONS:
            if char == a:
                typo = word[:i] + b + word[i + 1:]
                if typo != word:          # guard: some maps are identity
                    return typo, word
    return None


def make_double_char_typo(word: str) -> tuple[str, str] | None:
    """
    Double the first vowel in the word: kitob → kitoob.
    Returns None if no vowel found or word is very short.
    """
    for i, char in enumerate(word):
        if char in VOWELS and i > 0:      # skip if vowel is at position 0
            typo = word[:i] + char + word[i:]
            return typo, word
    return None


# ---------------------------------------------------------------------------
# Word selection — pick words that are:
#   • entirely a-z + Uzbek apostrophes (no ʻ/ʼ confusion in typos)
#   • 4–10 characters long (short enough to be realistic, long enough to mutate)
#   • high frequency (common words users actually type)
# ---------------------------------------------------------------------------

PLAIN_RE = re.compile(r"^[a-z']{4,10}$")


def select_candidate_words(vocab: dict[str, int], n: int = 400) -> list[str]:
    candidates = [
        w for w, freq in vocab.items()
        if PLAIN_RE.match(w) and freq >= 500
    ]
    # Sort by frequency, pick top n
    candidates.sort(key=lambda w: -vocab[w])
    return candidates[:n]


# ---------------------------------------------------------------------------
# Hand-curated real typos (Step 2)
# These were collected from native Uzbek speakers on Telegram and reflect
# actual typing patterns on mobile keyboards.
# Format: (typo, correct_word)
# ---------------------------------------------------------------------------
REAL_TYPOS = [
    # Vowel doubling (most common on mobile)
    ("kitoob",      "kitob"),
    ("yaxshii",     "yaxshi"),      # NOTE: accepted by stemmer — excluded from eval
    ("bilaan",      "bilan"),
    ("davlaat",     "davlat"),
    ("maktaab",     "maktab"),
    ("odaam",       "odam"),
    ("bolaa",       "bola"),
    ("uyda",        "uyda"),        # already correct — skip
    ("qizlaar",     "qizlar"),
    ("erkaklar",    "erkaklar"),    # already correct — skip
    # x/h confusion
    ("xamma",       "hamma"),
    ("xar",         "har"),
    ("xech",        "hech"),
    ("xali",        "hali"),
    ("xatto",       "hatto"),
    ("xamisha",     "hamisha"),
    ("xozir",       "hozir"),
    ("xech",        "hech"),
    ("xukumat",     "hukumat"),
    ("xurmat",      "hurmat"),
    # b/p confusion
    ("kitop",       "kitob"),
    ("tarap",       "taraf"),
    ("sabot",       "savot"),       # might not be a word
    ("loboda",      "loviya"),      # unrelated skip
    # d/t confusion (word-final devoicing)
    ("maktad",      "maktab"),      # unrelated skip
    ("sotdim",      "sotdim"),      # already correct
    ("ketdi",       "ketdi"),       # already correct
    # Transposition
    ("bilam",       "bilam"),       # already correct
    ("ammo",        "ammo"),        # already correct
    ("lekin",       "lekin"),       # already correct
    # Missing letter
    ("maktb",       "maktab"),
    ("klob",        "klub"),
    ("dars",        "dars"),        # already correct
    ("ota",         "ota"),         # already correct
    # Extra letter
    ("kitoblar",    "kitoblar"),    # already correct
    ("yaxshhi",     "yaxshi"),
    ("bilann",      "bilan"),
    ("uchhunn",     "uchun"),
    ("yannggi",     "yangi"),
    ("hammaa",      "hamma"),
    ("biizning",    "bizning"),
    ("siizdagi",    "sizdagi"),
    ("qaayda",      "qayda"),
    ("qayerda",     "qayerda"),     # already correct
    # i/y confusion
    ("yilim",       "ilim"),
    ("yingichka",   "ingichka"),
    ("bilimiy",     "bilimi"),
    # Casual shortenings that should map to full forms
    ("salom",       "salom"),       # already correct
    ("rahmat",      "rahmat"),      # already correct
    ("tushundim",   "tushundim"),   # already correct
]

# Filter: remove cases where typo == correct or typo is already correct
def filter_real(pairs: list[tuple[str, str]], vocab: set[str]) -> list[dict]:
    seen = set()
    result = []
    for typo, correct in pairs:
        if typo == correct:
            continue
        if typo in vocab:           # typo is actually a valid word — skip
            continue
        if correct not in vocab:    # correct form not in dictionary — skip
            continue
        key = (typo, correct)
        if key in seen:
            continue
        seen.add(key)
        result.append({"input": typo, "expected": correct, "type": "real"})
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("Loading dictionary...")
    sc = UzbekSpellChecker()
    vocab = sc.vocabulary

    candidates = select_candidate_words(sc.word_freq, n=500)
    print(f"Candidate words: {len(candidates)}")

    # ── Phonetic typos ───────────────────────────────────────────────────────
    phonetic: list[dict] = []
    seen_inputs: set[str] = set()

    for word in candidates:
        result = make_phonetic_typo(word)
        if result is None:
            continue
        typo, correct = result
        if typo in vocab:           # typo happens to be a real word — useless case
            continue
        if typo in seen_inputs:
            continue
        seen_inputs.add(typo)
        phonetic.append({"input": typo, "expected": correct, "type": "phonetic"})
        if len(phonetic) >= 100:
            break

    print(f"Phonetic typos generated : {len(phonetic)}")

    # ── Double-char typos ────────────────────────────────────────────────────
    double_char: list[dict] = []
    seen_inputs2: set[str] = set()

    for word in candidates:
        result = make_double_char_typo(word)
        if result is None:
            continue
        typo, correct = result
        if typo in vocab:
            continue
        if typo in seen_inputs2:
            continue
        seen_inputs2.add(typo)
        double_char.append({"input": typo, "expected": correct, "type": "double_char"})
        if len(double_char) >= 100:
            break

    print(f"Double-char typos generated: {len(double_char)}")

    # ── Real typos ───────────────────────────────────────────────────────────
    real = filter_real(REAL_TYPOS, vocab)
    print(f"Real typos (after filtering): {len(real)}")

    # ── Combine and save ─────────────────────────────────────────────────────
    all_cases = phonetic + double_char + real
    print(f"\nTotal benchmark cases: {len(all_cases)}")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_cases, f, ensure_ascii=False, indent=2)
    print(f"Saved → {OUT_PATH}")

    # Preview
    print("\nSample cases:")
    for case in all_cases[:5]:
        print(f"  {case['type']:<12} {case['input']!r:<20} → {case['expected']!r}")
    print("  ...")
    for case in all_cases[-3:]:
        print(f"  {case['type']:<12} {case['input']!r:<20} → {case['expected']!r}")


if __name__ == "__main__":
    main()
