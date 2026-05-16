"""
Step 1 — Scrape kun.uz for Uzbek Latin news text.

Crawls the /news listing pages, collects article URLs, fetches each
article, strips HTML, and extracts Uzbek Latin words.  Output is saved
to uzbek_text_tools/data/news_words.json as {word: frequency}.

Usage:
    python scripts/scrape_news.py

Produces: uzbek_text_tools/data/news_words.json
"""
import json
import os
import re
import sys
import time
from collections import Counter

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# kun.uz category pages  (no login required, Uzbek Latin content)
CATEGORY_URLS = [
    "https://kun.uz/news/category/uzbekiston",
    "https://kun.uz/news/category/jamiyat",
    "https://kun.uz/news/category/iqtisodiyot",
    "https://kun.uz/news/category/jahon",
    "https://kun.uz/news/category/sport",
    "https://kun.uz/news/category/texnologiya",
]
MAX_ARTICLES  = 50          # article pages to fetch total
DELAY         = 0.6         # seconds between requests (polite crawling)
MIN_FREQ      = 2           # drop words seen only once
OUT_PATH      = os.path.join(os.path.dirname(__file__), "..", "uzbek_text_tools", "data", "news_words.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; uzbek-text-tools-corpus-builder/0.1; "
        "+https://github.com/umid150708/uzbek-text-tools)"
    )
}

# Uzbek Latin word pattern — includes ʻ ʼ (O'zbekcha apostrophes)
WORD_RE = re.compile(r"[a-zA-ZʻʼoOgG']{3,}")

# Block common English / markup noise that leaks through
BLOCKLIST = {
    "the", "and", "for", "are", "was", "you", "that", "this",
    "with", "from", "have", "has", "will", "not", "but", "all",
    "www", "com", "http", "https", "html", "css", "jpg", "png",
    "kun", "news", "read", "more", "share", "like", "view",
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


def extract_article_links(html: str) -> list[str]:
    """
    Pull article links from a kun.uz category page.
    Real article URLs look like: /news/YYYY/MM/DD/<slug>
    """
    soup = BeautifulSoup(html, "html.parser")
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        # Match /news/YYYY/... pattern; skip category/audio/time pages
        if re.search(r"/news/\d{4}/", href) and "/category/" not in href:
            full = href if href.startswith("http") else "https://kun.uz" + href
            if full not in links:
                links.append(full)
    return links


def extract_words(html: str) -> list[str]:
    """Strip HTML and return a list of lowercase Uzbek Latin words."""
    soup = BeautifulSoup(html, "html.parser")
    # Remove script / style / nav noise
    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()
    text = soup.get_text(separator=" ")
    words = WORD_RE.findall(text)
    return [w.lower() for w in words if w.lower() not in BLOCKLIST]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("Step 1 — Scraping kun.uz")
    print("=" * 60)

    # ── Collect article URLs ─────────────────────────────────────────────────
    print(f"\nPhase A: collecting article links from {len(CATEGORY_URLS)} category pages...")
    article_urls: list[str] = []

    for cat_url in CATEGORY_URLS:
        resp = get(cat_url)
        if resp is None:
            continue
        links = extract_article_links(resp.text)
        new_links = [l for l in links if l not in article_urls]
        article_urls.extend(new_links)
        cat_name = cat_url.split("/")[-1]
        print(f"  {cat_name:<20}: {len(new_links):2d} new links  (total {len(article_urls)})")
        time.sleep(DELAY)
        if len(article_urls) >= MAX_ARTICLES * 2:
            break

    article_urls = article_urls[:MAX_ARTICLES]
    print(f"\n  → Will fetch {len(article_urls)} articles")

    # ── Fetch articles and extract words ────────────────────────────────────
    print(f"\nPhase B: fetching {len(article_urls)} articles...")
    counter: Counter = Counter()

    for idx, url in enumerate(article_urls, 1):
        resp = get(url)
        if resp is None:
            continue
        words = extract_words(resp.text)
        counter.update(words)
        if idx % 10 == 0 or idx == len(article_urls):
            print(f"  {idx:3d}/{len(article_urls)}  unique tokens so far: {len(counter):,}")
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
