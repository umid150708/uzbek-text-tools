"""
Step 5 — Scan word_freq.json for garbage entries and optionally remove them.

Prints the 50 lowest-frequency words that were added since the previous
run, and flags entries that look suspicious:
  - contain non-Latin / non-Uzbek characters
  - are single characters
  - look like English words (simple heuristic)
  - are very short (2 chars) but not on the allowlist

Usage:
    # Review only (no changes)
    python scripts/check_garbage.py

    # Review and remove flagged entries
    python scripts/check_garbage.py --remove
"""
import argparse
import json
import os
import re
import sys

DICT_PATH  = os.path.join(os.path.dirname(__file__), "..", "uzbek_text_tools", "data", "word_freq.json")

# Uzbek 2-char words that are real (allowlist prevents false positives)
SHORT_OK = {
    "va", "bu", "u", "o'", "ha", "yo", "ey", "oh",
    "ga", "da", "ni", "to", "bo", "go", "ko",
}

# Common English words that shouldn't be in an Uzbek dictionary
ENGLISH_NOISE = {
    "the", "and", "for", "are", "was", "you", "that", "this",
    "with", "from", "have", "will", "not", "but", "all", "one",
    "into", "more", "also", "been", "its", "can", "said",
    "about", "than", "had", "they", "their", "who", "would",
    "there", "when", "what", "which", "were", "each", "she",
    "him", "his", "her", "our", "out", "use", "how", "man",
    "new", "way", "may", "day", "get", "has", "him", "did",
    "come", "made", "part", "over", "such", "then", "only",
    "just", "know", "like", "time", "very", "after", "through",
    "back", "little", "good", "well", "even", "much", "before",
    "most", "other", "some", "these", "while", "where", "being",
}

# Valid Uzbek Latin chars only
VALID_RE   = re.compile(r"^[a-zA-ZʻʼoOgG']+$")


def flag_reason(word: str, freq: int) -> str | None:
    if len(word) == 1:
        return "single character"
    if len(word) == 2 and word not in SHORT_OK:
        return "2-char word not on allowlist"
    if not VALID_RE.match(word):
        return "contains non-Uzbek-Latin characters"
    if word in ENGLISH_NOISE:
        return "common English word"
    if word.endswith("'s") or word.endswith("'t"):
        return "English possessive/contraction"
    # Flag words that are mostly consonants (likely encoding garbage)
    vowels = sum(1 for c in word if c in "aeiouoʻ")
    if len(word) >= 5 and vowels == 0:
        return "zero vowels (likely garbage)"
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan word_freq.json for garbage.")
    parser.add_argument("--remove", action="store_true",
                        help="Remove flagged entries from the dictionary.")
    args = parser.parse_args()

    with open(DICT_PATH, encoding="utf-8") as f:
        word_freq: dict[str, int] = json.load(f)

    print(f"Dictionary size: {len(word_freq):,} words\n")

    # ── Flagged entries ───────────────────────────────────────────────────────
    flagged: list[tuple[str, int, str]] = []
    for word, freq in word_freq.items():
        reason = flag_reason(word, freq)
        if reason:
            flagged.append((word, freq, reason))

    flagged.sort(key=lambda x: x[1])   # lowest frequency first

    if flagged:
        print(f"{'='*60}")
        print(f"Flagged entries ({len(flagged)} total):")
        print(f"{'='*60}")
        for word, freq, reason in flagged[:60]:
            print(f"  freq={freq:<6}  {word:<25}  [{reason}]")
        if len(flagged) > 60:
            print(f"  ... and {len(flagged) - 60} more")
    else:
        print("No flagged entries — dictionary looks clean.")

    # ── 50 lowest-frequency words overall ─────────────────────────────────────
    print(f"\n{'='*60}")
    print("50 lowest-frequency words (sanity check):")
    print(f"{'='*60}")
    lowest = sorted(word_freq.items(), key=lambda x: x[1])[:50]
    for word, freq in lowest:
        flag = "  ← FLAGGED" if flag_reason(word, freq) else ""
        print(f"  freq={freq:<6}  {word}{flag}")

    # ── Optionally remove ──────────────────────────────────────────────────────
    if args.remove and flagged:
        to_remove = {w for w, _, _ in flagged}
        cleaned = {w: f for w, f in word_freq.items() if w not in to_remove}
        cleaned_sorted = dict(sorted(cleaned.items(), key=lambda x: -x[1]))
        with open(DICT_PATH, "w", encoding="utf-8") as f:
            json.dump(cleaned_sorted, f, ensure_ascii=False, indent=2)
        print(f"\n  Removed {len(to_remove):,} flagged entries.")
        print(f"  Dictionary size: {len(word_freq):,} → {len(cleaned_sorted):,}")
        print(f"  Saved → {DICT_PATH}")
    elif args.remove:
        print("\n  Nothing to remove.")
    else:
        print(f"\n  (Run with --remove to delete {len(flagged)} flagged entries.)")


if __name__ == "__main__":
    main()
