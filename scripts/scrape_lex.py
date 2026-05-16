"""
Step 2 — Scrape lex.uz for Uzbek Latin government/legal text.

lex.uz publishes Uzbek laws and decrees in Latin script.  This script
fetches the document listing and then the full text of each document,
extracts Uzbek Latin words, and saves the frequency dict to
uzbek_text_tools/data/gov_words.json.

Usage:
    python scripts/scrape_lex.py

Produces: uzbek_text_tools/data/gov_words.json
"""
import json
import os
import re
import time
from collections import Counter

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# lex.uz homepage and classifier pages expose /uz/docs/<id> links directly.
LISTING_URLS = [
    "https://lex.uz/uz/",
    "https://lex.uz/uz/classifiers/18926",
    "https://lex.uz/uz/classifiers/18932",
]
MAX_DOCS  = 20
DELAY     = 0.6
MIN_FREQ  = 2
OUT_PATH  = os.path.join(os.path.dirname(__file__), "..", "uzbek_text_tools", "data", "gov_words.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; uzbek-text-tools-corpus-builder/0.1; "
        "+https://github.com/umid150708/uzbek-text-tools)"
    )
}

WORD_RE   = re.compile(r"[a-zA-ZʻʼoOgG']{3,}")
BLOCKLIST = {
    "the", "and", "for", "are", "was", "from", "that", "this",
    "with", "have", "will", "not", "all", "www", "com", "http",
    "lex", "doc", "pdf", "html", "jpg", "ref",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get(url: str, retries: int = 3) -> requests.Response | None:
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            return resp
        except Exception as exc:
            if attempt == retries - 1:
                print(f"    [skip] {url} — {exc}")
                return None
            time.sleep(1)
    return None


def extract_doc_links(html: str) -> list[str]:
    """Find /uz/docs/<id> links on a lex.uz listing page.
    IDs can be positive or negative integers."""
    soup = BeautifulSoup(html, "html.parser")
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        # Match /uz/docs/-123456 or /uz/docs/123456
        if re.search(r"/uz/docs/-?\d+", href):
            full = href if href.startswith("http") else "https://lex.uz" + href
            if full not in links:
                links.append(full)
    return links


def extract_words(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    text = soup.get_text(separator=" ")
    words = WORD_RE.findall(text)
    return [w.lower() for w in words if w.lower() not in BLOCKLIST]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("Step 2 — Scraping lex.uz (government documents)")
    print("=" * 60)

    # ── Collect document URLs ────────────────────────────────────────────────
    print(f"\nPhase A: collecting document links...")
    doc_urls: list[str] = []

    for listing_url in LISTING_URLS:
        resp = get(listing_url)
        if resp is None:
            continue
        links = extract_doc_links(resp.text)
        new = [l for l in links if l not in doc_urls]
        doc_urls.extend(new)
        label = listing_url.split("/")[-1]
        print(f"  {label:<20}: {len(new):2d} new links  (total {len(doc_urls)})")
        time.sleep(DELAY)
        if len(doc_urls) >= MAX_DOCS * 2:
            break

    doc_urls = doc_urls[:MAX_DOCS]
    print(f"\n  → Will fetch {len(doc_urls)} documents")

    if not doc_urls:
        print("\n  No document links found — lex.uz may have changed its structure.")
        print("  Saving empty gov_words.json as placeholder.")
        os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump({}, f)
        return

    # ── Fetch documents and extract words ────────────────────────────────────
    print(f"\nPhase B: fetching {len(doc_urls)} documents...")
    counter: Counter = Counter()

    for idx, url in enumerate(doc_urls, 1):
        resp = get(url)
        if resp is None:
            continue
        words = extract_words(resp.text)
        counter.update(words)
        print(f"  {idx:2d}/{len(doc_urls)}  +{len(words):,} tokens  unique so far: {len(counter):,}")
        time.sleep(DELAY)

    print(f"\n  Raw tokens  : {sum(counter.values()):,}")
    print(f"  Unique words: {len(counter):,}")

    # ── Filter and save ──────────────────────────────────────────────────────
    filtered = {w: c for w, c in counter.items() if c >= MIN_FREQ and len(w) >= 3}
    filtered = dict(sorted(filtered.items(), key=lambda x: -x[1]))
    print(f"  After MIN_FREQ={MIN_FREQ} filter: {len(filtered):,} words")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(filtered, f, ensure_ascii=False, indent=2)
    print(f"\n  Saved → {OUT_PATH}")

    print("\nTop 20 words:")
    for word, freq in list(filtered.items())[:20]:
        print(f"  {freq:>5}  {word}")


if __name__ == "__main__":
    main()
