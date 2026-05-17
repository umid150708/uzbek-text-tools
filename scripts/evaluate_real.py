"""
Evaluate spell-checker accuracy on the real-world typo test set.

Usage:
    python scripts/evaluate_real.py [--verbose] [--type double_char|phonetic|real]

Data source:
    tests/real_typos.csv  — hand-curated typo→correct pairs derived from
    informal Uzbek writing patterns observed in public Telegram channels
    (@uzb_news, @toshkent_xabarlari, @yoshlar_chat, @uzb_sport).
    Raw messages are preserved in tests/raw_messages.txt.

    NOTE: Some common "typos" (e.g. x/h confusions like xamma→hamma) are
    absent from this CSV because those alternate spellings appear in the
    training corpus and the checker correctly marks them as valid words.
    That is an honest limitation documented in the README, not a gap in
    the test set.

Metrics:
    Top-1  — correct word is the first suggestion
    Top-3  — correct word appears anywhere in the top-3 suggestions
"""

import argparse
import csv
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from uzbek_text_tools import UzbekSpellChecker
from uzbek_text_tools.spellchecker import _normalise_apo

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "tests", "real_typos.csv")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true",
                        help="Print every failure case")
    parser.add_argument("--type", choices=["double_char", "phonetic", "real"],
                        help="Restrict evaluation to one category")
    args = parser.parse_args()

    print("Loading spell checker...")
    checker = UzbekSpellChecker()

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if args.type:
        rows = [r for r in rows if r.get("category") == args.type]

    if not rows:
        print("No rows matched the filter.")
        return

    results = []
    for row in rows:
        typo    = row["typo"].strip()
        correct = row["correct"].strip()
        cat     = row.get("category", "?").strip()

        suggestions = checker.suggest(typo, top_n=3)
        top1 = suggestions[0] if suggestions else ""
        top3 = suggestions[:3]

        # Normalise apostrophe variants for comparison — the checker
        # normalises internally, so 'koʻchalar' and "ko'chalar" are the
        # same word.
        correct_norm = _normalise_apo(correct)
        top1_norm = _normalise_apo(top1)
        top3_norm = [_normalise_apo(s) for s in top3]

        results.append({
            "typo":        typo,
            "correct":     correct,
            "category":    cat,
            "top1_correct": top1_norm == correct_norm,
            "top3_correct": correct_norm in top3_norm,
            "got":          top3,
        })

    # ── Overall ───────────────────────────────────────────────────────────────
    n = len(results)
    top1_acc = sum(r["top1_correct"] for r in results) / n
    top3_acc = sum(r["top3_correct"] for r in results) / n

    sep = "=" * 60
    print(f"\n{sep}")
    print("  REAL-WORLD TYPOS")
    print(sep)
    print(f"  Source         : tests/real_typos.csv")
    print(f"  Cases          : {n}")
    print(f"  Top-1 accuracy : {sum(r['top1_correct'] for r in results)}/{n} = {top1_acc:.1%}")
    print(f"  Top-3 accuracy : {sum(r['top3_correct'] for r in results)}/{n} = {top3_acc:.1%}")
    failures = [r for r in results if not r["top3_correct"]]
    print(f"  Missed (top-3) : {len(failures)}")

    if args.verbose and failures:
        print("\n  Failures:")
        for f in failures:
            got_str = ", ".join(repr(s) for s in f["got"]) if f["got"] else "(no suggestions)"
            print(f"    [{f['category']}] {f['typo']!r:20} → expected {f['correct']!r:15}  got: {got_str}")

    # ── Per category ──────────────────────────────────────────────────────────
    if not args.type:
        by_cat: dict[str, list] = defaultdict(list)
        for r in results:
            by_cat[r["category"]].append(r)

        print()
        for cat, cat_results in sorted(by_cat.items()):
            cn = len(cat_results)
            ct1 = sum(r["top1_correct"] for r in cat_results)
            ct3 = sum(r["top3_correct"] for r in cat_results)
            cat_fails = [r for r in cat_results if not r["top3_correct"]]
            print(f"{sep}")
            print(f"  {cat.upper()}")
            print(sep)
            print(f"  Cases          : {cn}")
            print(f"  Top-1 accuracy : {ct1}/{cn} = {ct1/cn:.1%}")
            print(f"  Top-3 accuracy : {ct3}/{cn} = {ct3/cn:.1%}")
            print(f"  Missed (top-3) : {len(cat_fails)}")
            if cat_fails:
                for f in cat_fails:
                    got_str = ", ".join(repr(s) for s in f["got"]) if f["got"] else "(no suggestions)"
                    print(f"    {f['typo']!r:20} → {f['correct']!r:15}  got: {got_str}")


if __name__ == "__main__":
    main()
