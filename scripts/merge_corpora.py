"""
Step 4 — Merge all corpus additions into the main word_freq.json.

Sources merged (in order):
  1. uzbek_text_tools/data/word_freq.json      ← base dictionary (Wikipedia + CC-100)
  2. uzbek_text_tools/data/news_words.json     ← kun.uz news scrape (Step 1)
  3. uzbek_text_tools/data/gov_words.json      ← lex.uz legal text (Step 2)
  4. uzbek_text_tools/data/informal_words.txt  ← hand-curated informal/SMS vocab (Step 3)

For JSON sources: word counts are summed.
For the .txt source: each word is added with frequency 1 if not already present.

Usage:
    python scripts/merge_corpora.py

Output: overwrites uzbek_text_tools/data/word_freq.json in place.
"""
import json
import os
import re
import sys

DATA_DIR   = os.path.join(os.path.dirname(__file__), "..", "uzbek_text_tools", "data")
BASE_PATH  = os.path.join(DATA_DIR, "word_freq.json")
NEWS_PATH  = os.path.join(DATA_DIR, "news_words.json")
GOV_PATH   = os.path.join(DATA_DIR, "gov_words.json")
INFO_PATH  = os.path.join(DATA_DIR, "informal_words.txt")

# Uzbek Latin word guard — anything with non-Latin / non-apostrophe chars is skipped
VALID_RE   = re.compile(r"^[a-zA-ZʻʼoOgG']{2,}$")


def load_json(path: str) -> dict[str, int]:
    if not os.path.exists(path):
        print(f"  [skip] not found: {path}")
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_txt(path: str) -> dict[str, int]:
    """Parse one-word-per-line .txt; skip comment lines and empty lines."""
    if not os.path.exists(path):
        print(f"  [skip] not found: {path}")
        return {}
    words: dict[str, int] = {}
    with open(path, encoding="utf-8") as f:
        for raw in f:
            word = raw.split("#")[0].strip().lower()
            if not word:
                continue
            if not VALID_RE.match(word):
                continue
            words[word] = 1   # informal list uses frequency 1
    return words


def merge(*sources: dict[str, int]) -> dict[str, int]:
    """Sum frequencies from all source dicts."""
    result: dict[str, int] = {}
    for src in sources:
        for word, count in src.items():
            if not VALID_RE.match(word):
                continue          # skip any garbage that slipped through
            result[word] = result.get(word, 0) + count
    return result


def main() -> None:
    print("=" * 60)
    print("Merging corpora into word_freq.json")
    print("=" * 60)

    # ── Load all sources ─────────────────────────────────────────────────────
    print("\nLoading sources...")
    base     = load_json(BASE_PATH);  print(f"  Base dict     : {len(base):>10,} words")
    news     = load_json(NEWS_PATH);  print(f"  News (kun.uz) : {len(news):>10,} words")
    gov      = load_json(GOV_PATH);   print(f"  Gov  (lex.uz) : {len(gov):>10,} words")
    informal = load_txt(INFO_PATH);   print(f"  Informal list : {len(informal):>10,} words")

    # ── Merge ────────────────────────────────────────────────────────────────
    print("\nMerging...")
    merged = merge(base, news, gov, informal)

    # Sort by frequency descending
    sorted_dict = dict(sorted(merged.items(), key=lambda x: -x[1]))

    # ── Report ───────────────────────────────────────────────────────────────
    new_words = len(sorted_dict) - len(base)
    print(f"\n  Before merge : {len(base):,} words")
    print(f"  Added        : {new_words:,} new words")
    print(f"  Total        : {len(sorted_dict):,} words")

    # ── Save ─────────────────────────────────────────────────────────────────
    with open(BASE_PATH, "w", encoding="utf-8") as f:
        json.dump(sorted_dict, f, ensure_ascii=False, indent=2)
    print(f"\n  Saved → {BASE_PATH}")

    # ── Spot-check ───────────────────────────────────────────────────────────
    print("\nSpot-check (words added from new sources):")
    spot = [
        ("keldim",      "informal verb"),
        ("ketdim",      "informal verb"),
        ("chiroyli",    "casual adjective"),
        ("bitta",       "informal numeral"),
        ("hozir",       "time word"),
        ("qildi",       "casual verb"),
        ("obuna",       "internet term"),
        ("xabar",       "messaging term"),
    ]
    for word, label in spot:
        freq = sorted_dict.get(word)
        mark = "✓" if freq else "✗"
        status = f"freq={freq:,}" if freq else "MISSING"
        print(f"  {mark}  {word:<18} {status:<16} ({label})")


if __name__ == "__main__":
    main()
