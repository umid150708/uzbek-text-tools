"""
Expand word_freq.json with casual Uzbek vocabulary from the CC-100 corpus.
CC-100 is a web-crawled dataset — it contains news, blogs, forums, and
social-media text that Wikipedia misses.

Downloads uz.txt.xz directly from statmt.org (~161 MB) and streams it
line by line without loading the whole file into memory.

Usage:
    python scripts/add_cc100.py
"""
import json
import lzma
import re
import sys
import os
import urllib.request
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from uzbek_text_tools.transliterator import transliterate

DICT_PATH  = os.path.join(os.path.dirname(__file__), "..", "uzbek_text_tools", "data", "word_freq.json")
CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "uz.txt.xz")
CC100_URL  = "https://data.statmt.org/cc-100/uz.txt.xz"
CAP        = 500_000   # lines to process
MIN_FREQ   = 3
REPORT_EVERY = 50_000

CYRILLIC_RE = re.compile(r"[Ѐ-ӿ]")
ALPHA_RE    = re.compile(r"[\w]")
WORD_RE     = re.compile(r"[a-zA-ZʻʼoOgG']{2,}")

BLOCKLIST = {
    "the", "of", "and", "in", "to", "is", "was", "for", "on", "are",
    "with", "at", "by", "an", "as", "or", "be", "from", "this", "that",
    "thumb", "left", "right", "center", "frame", "alt", "ref", "cite",
}


def maybe_transliterate(text: str) -> str:
    alpha = ALPHA_RE.findall(text)
    if not alpha:
        return text
    cyr_ratio = len(CYRILLIC_RE.findall(text)) / len(alpha)
    return transliterate(text) if cyr_ratio > 0.1 else text


def extract_words(text: str) -> list[str]:
    text = maybe_transliterate(text)
    return [w for w in WORD_RE.findall(text.lower()) if w not in BLOCKLIST]


def download_if_needed():
    if os.path.exists(CACHE_PATH):
        size = os.path.getsize(CACHE_PATH)
        print(f"  Found cached uz.txt.xz ({size / 1e6:.0f} MB) — skipping download")
        return
    print(f"  Downloading {CC100_URL} ...")
    def progress(count, block, total):
        pct = count * block * 100 // total
        print(f"\r  {pct}% ({count * block / 1e6:.0f} / {total / 1e6:.0f} MB)", end="", flush=True)
    urllib.request.urlretrieve(CC100_URL, CACHE_PATH, reporthook=progress)
    print(f"\n  Downloaded → {CACHE_PATH}")


def main():
    print("Loading existing dictionary...")
    with open(DICT_PATH, encoding="utf-8") as f:
        existing: dict[str, int] = json.load(f)
    before = len(existing)
    print(f"  Current size: {before:,} words")

    print(f"\nStep 1 — Downloading CC-100 Uzbek corpus:")
    download_if_needed()

    print(f"\nStep 2 — Extracting words (up to {CAP:,} lines)...")
    counter: Counter = Counter()
    line_count = 0

    with lzma.open(CACHE_PATH, mode="rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            counter.update(extract_words(line))
            line_count += 1
            if line_count % REPORT_EVERY == 0:
                print(f"  {line_count:>7,} lines — {len(counter):,} unique tokens")
            if line_count >= CAP:
                break

    print(f"\n  Done: {line_count:,} lines, {len(counter):,} unique tokens")

    print("\nStep 3 — Merging into dictionary...")
    added = 0
    for word, freq in counter.items():
        if freq >= MIN_FREQ:
            if word not in existing:
                added += 1
            existing[word] = existing.get(word, 0) + freq

    sorted_dict = dict(sorted(existing.items(), key=lambda x: -x[1]))

    print(f"  Before  : {before:,} words")
    print(f"  Added   : {added:,} new words")
    print(f"  Total   : {len(sorted_dict):,} words")

    with open(DICT_PATH, "w", encoding="utf-8") as f:
        json.dump(sorted_dict, f, ensure_ascii=False, indent=2)
    print(f"\n  Saved → {DICT_PATH}")

    print("\nSpot-check (casual words Wikipedia misses):")
    for word in ["qildim", "ketdim", "bordim", "keldi", "dedim",
                 "bilaman", "ko'rdim", "yozdim", "o'qidim", "sevaman"]:
        freq = sorted_dict.get(word)
        mark = "✓" if freq else "✗"
        status = f"freq={freq:,}" if freq else "MISSING"
        print(f"  {mark}  {word:<15} {status}")


if __name__ == "__main__":
    main()
