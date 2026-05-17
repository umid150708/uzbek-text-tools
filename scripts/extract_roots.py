"""
Fix 5, Step 1 — Extract root-only dictionary from word_freq.json.

For every word in the full dictionary, run iterative_strip().  If the
output differs from the input, the original was a surface (inflected)
form — its frequency is folded into the root.  Only roots survive.

Output:
    uzbek_text_tools/data/word_freq_roots.json

Usage:
    python scripts/extract_roots.py [--review N] [--dry-run] [--autonomous-threshold N]

  --review N               Print N random entries from the roots dict for manual review
  --dry-run                Do not write the output file; just print stats
  --autonomous-threshold N Keep words with freq >= N as autonomous roots even if
                           they can be stripped (default: 1000).  This prevents
                           high-frequency standalone words like 'hamda' (conjunction)
                           from being folded into 'ham'.

STATUS (v0.2): EXPERIMENTAL — do not ship.
    Accuracy on real_typos.csv drops from 97.6% to 59.8% (top-3) because common
    words like 'hamda', 'amalga', 'yoshlar', 'yilda' get folded into roots.
    v0.3 needs:
      1. Autonomous-word threshold (--autonomous-threshold) to keep frequent
         standalone forms as their own roots
      2. Frequency ratio guard: only fold if freq(word) << freq(root)
      3. Conjunction/adverb stop-list to prevent 'hamda', 'yoki', 'lekin' folding
"""

import argparse
import json
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from uzbek_text_tools.stemmer import iterative_strip, strip_suffix
from uzbek_text_tools.spellchecker import MIN_STEM_FREQ
from uzbek_text_tools.data_loader import load_dictionary

OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "uzbek_text_tools", "data", "word_freq_roots.json"
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract roots-only dictionary")
    parser.add_argument("--review", type=int, default=0,
                        help="Print N random roots for manual review")
    parser.add_argument("--dry-run", action="store_true",
                        help="Do not write output, only print stats")
    parser.add_argument("--autonomous-threshold", type=int, default=1000,
                        help="Keep words with freq >= N as autonomous roots "
                             "even if they can be suffix-stripped (default: 1000)")
    args = parser.parse_args()

    print("Loading full dictionary...")
    word_freq = load_dictionary()
    full_vocab = set(word_freq.keys())
    print(f"  Full dictionary: {len(word_freq):,} entries")
    print(f"  MIN_STEM_FREQ gate: {MIN_STEM_FREQ}")

    # Build a frequency-gated vocabulary: only accept stems whose frequency
    # meets MIN_STEM_FREQ.  This prevents `kishi→kish` (freq=5) style
    # over-strips where garbage fragments sneak into the CC-100 corpus.
    freq_vocab = frozenset(w for w, f in word_freq.items() if f >= MIN_STEM_FREQ)
    auto_thresh = args.autonomous_threshold
    print(f"  Freq-gated vocab     : {len(freq_vocab):,} entries (freq >= {MIN_STEM_FREQ})")
    print(f"  Autonomous threshold : {auto_thresh:,}")

    # ── Phase 1: classify each word as root or surface form ──────────────────
    roots: dict[str, int] = {}       # root → aggregated frequency
    surface_count = 0
    autonomous_kept = 0
    strip_examples: list[tuple[str, str]] = []  # (surface, root) for review

    for word, freq in word_freq.items():
        # AUTONOMOUS WORD GUARD: high-frequency words survive as their own
        # root regardless of suffix-strippability.  This prevents standalone
        # lexemes like 'hamda' (conjunction, freq=110k) from being folded
        # into 'ham'.
        if freq >= auto_thresh:
            roots[word] = roots.get(word, 0) + freq
            autonomous_kept += 1
            continue

        # Try stripping with freq-gated vocabulary as the gate.
        # This means a strip is only accepted if the resulting stem is BOTH
        # in the dictionary AND has frequency >= MIN_STEM_FREQ.
        candidates = iterative_strip(word, max_passes=3, vocabulary=freq_vocab)

        if candidates:
            # Word is a surface form — fold its freq into the deepest root
            root = candidates[-1]
            roots[root] = roots.get(root, 0) + freq
            surface_count += 1
            if len(strip_examples) < 5000:
                strip_examples.append((word, root))
        else:
            # Word is already a root (or couldn't be stripped)
            roots[word] = roots.get(word, 0) + freq

    # ── Phase 2: stats ───────────────────────────────────────────────────────
    print(f"\n  Results:")
    print(f"    Autonomous (kept)    : {autonomous_kept:,}")
    print(f"    Surface forms folded : {surface_count:,}")
    print(f"    Root entries         : {len(roots):,}")
    print(f"    Reduction            : {100 * (1 - len(roots) / len(word_freq)):.1f}%")

    # Show some strip examples
    if strip_examples:
        print(f"\n  Sample strips (first 20):")
        for surface, root in strip_examples[:20]:
            print(f"    {surface:25} → {root}")

    # ── Phase 3: manual review ───────────────────────────────────────────────
    if args.review > 0:
        sample = random.sample(list(roots.items()), min(args.review, len(roots)))
        print(f"\n  Random review ({len(sample)} entries):")
        bad_count = 0
        for word, freq in sorted(sample, key=lambda x: -x[1]):
            # Flag suspicious roots: very short, or low frequency
            flags = []
            if len(word) <= 2:
                flags.append("SHORT")
            if freq < 5:
                flags.append("RARE")
            flag_str = f"  {'  '.join(flags)}" if flags else ""
            print(f"    {word:25} freq={freq:>8,}{flag_str}")
            if flags:
                bad_count += 1
        print(f"\n  Flagged entries: {bad_count}/{len(sample)}")

    # ── Phase 4: write output ────────────────────────────────────────────────
    if args.dry_run:
        print("\n  [DRY RUN] — not writing output file.")
    else:
        # Sort by frequency descending for human readability
        sorted_roots = dict(sorted(roots.items(), key=lambda x: -x[1]))
        os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
        with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(sorted_roots, f, ensure_ascii=False, indent=0)
        print(f"\n  Written: {OUTPUT_PATH}")
        print(f"  File size: {os.path.getsize(OUTPUT_PATH) / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
