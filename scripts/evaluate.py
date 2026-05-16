"""
Step 3 — Evaluate spell-checker accuracy against benchmark.json.

Metrics:
  Top-1 accuracy  — correct word is the first suggestion
  Top-3 accuracy  — correct word appears anywhere in top-3 suggestions

Usage:
    python scripts/evaluate.py [--verbose] [--type phonetic|double_char|real]

  --verbose  print every failure case
  --type     restrict evaluation to one category
"""
import argparse
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from uzbek_text_tools import UzbekSpellChecker

BENCH_PATH = os.path.join(os.path.dirname(__file__), "..", "uzbek_text_tools", "data", "benchmark.json")


def evaluate(cases: list[dict], checker: UzbekSpellChecker, verbose: bool = False):
    top1 = top3 = 0
    failures: list[dict] = []

    for case in cases:
        inp      = case["input"]
        expected = case["expected"]
        typo_type = case.get("type", "?")

        suggestions = checker.suggest(inp, top_n=3)

        hit1 = suggestions and suggestions[0] == expected
        hit3 = expected in suggestions

        if hit1:
            top1 += 1
        if hit3:
            top3 += 1
        else:
            failures.append({
                "type":       typo_type,
                "input":      inp,
                "expected":   expected,
                "got":        suggestions,
            })

    return top1, top3, failures


def print_report(label: str, top1: int, top3: int, total: int, failures: list[dict], verbose: bool) -> None:
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    print(f"  Cases           : {total}")
    print(f"  Top-1 accuracy  : {top1}/{total} = {top1/total:.1%}")
    print(f"  Top-3 accuracy  : {top3}/{total} = {top3/total:.1%}")
    missed_top3 = len(failures)
    print(f"  Missed (top-3)  : {missed_top3}")

    if verbose and failures:
        print(f"\n  Failures:")
        for f in failures:
            got_str = ", ".join(repr(s) for s in f["got"]) if f["got"] else "(no suggestions)"
            print(f"    [{f['type']}] {f['input']!r:20} → expected {f['expected']!r:15}  got: {got_str}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true", help="Print every failure")
    parser.add_argument("--type", choices=["phonetic", "double_char", "real"],
                        help="Restrict to one category")
    args = parser.parse_args()

    print("Loading spell checker...")
    checker = UzbekSpellChecker()

    with open(BENCH_PATH, encoding="utf-8") as f:
        all_cases = json.load(f)

    if args.type:
        all_cases = [c for c in all_cases if c.get("type") == args.type]

    # ── Overall ──────────────────────────────────────────────────────────────
    t1, t3, failures = evaluate(all_cases, checker, verbose=args.verbose)
    print_report("OVERALL", t1, t3, len(all_cases), failures, args.verbose)

    # ── Per category ─────────────────────────────────────────────────────────
    if not args.type:
        by_type: dict[str, list[dict]] = defaultdict(list)
        for c in all_cases:
            by_type[c.get("type", "?")].append(c)

        for cat, cases in sorted(by_type.items()):
            c1, c3, cat_failures = evaluate(cases, checker)
            print_report(cat.upper(), c1, c3, len(cases), cat_failures, args.verbose)

    # ── Failure analysis ─────────────────────────────────────────────────────
    if not args.type:
        print(f"\n{'='*60}")
        print("  FAILURE ANALYSIS (top-3 misses by category)")
        print(f"{'='*60}")
        by_type2: dict[str, list] = defaultdict(list)
        for f in failures:
            by_type2[f["type"]].append(f)
        for cat, flist in sorted(by_type2.items()):
            print(f"  {cat:<15}: {len(flist)} misses")
            for f in flist[:3]:
                got_str = ", ".join(repr(s) for s in f["got"]) if f["got"] else "(no suggestions)"
                print(f"    {f['input']!r:20} → {f['expected']!r:15}  got: {got_str}")
            if len(flist) > 3:
                print(f"    ... and {len(flist)-3} more")


if __name__ == "__main__":
    main()
