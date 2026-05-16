"""
Extract plain text from an Uzbek Wikipedia bz2 XML dump.
Writes one file per 1000 articles into extracted/AA/, extracted/AB/, ...
Usage: python scripts/extract_wiki.py
"""
import bz2
import os
import re
import xml.etree.ElementTree as ET
from itertools import islice

import mwparserfromhell

DUMP    = os.path.join(os.path.dirname(__file__), '..', 'uzwiki-latest-pages-articles.xml.bz2')
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'extracted', 'AA')
BATCH   = 1000  # articles per output file

os.makedirs(OUT_DIR, exist_ok=True)

# Strip wiki markup noise
CLEANUP = re.compile(r'={2,}[^=]+=+|http\S+|\[\[File:[^\]]+\]\]', re.IGNORECASE)

def strip_markup(wikitext: str) -> str:
    try:
        parsed = mwparserfromhell.parse(wikitext)
        text = parsed.strip_code()
    except Exception:
        text = wikitext
    return CLEANUP.sub(' ', text)


def iter_articles(dump_path: str):
    NS = 'http://www.mediawiki.org/xml/export-0.11/'
    with bz2.open(dump_path, 'rb') as f:
        for event, elem in ET.iterparse(f, events=('end',)):
            tag = elem.tag.split('}')[-1]
            if tag == 'page':
                ns_node = elem.find(f'{{{NS}}}ns')
                if ns_node is not None and ns_node.text != '0':
                    elem.clear()
                    continue
                text_node = elem.find(f'.//{{{NS}}}text')
                if text_node is not None and text_node.text:
                    yield strip_markup(text_node.text)
                elem.clear()


def main():
    batch, file_idx, total = [], 0, 0
    for text in iter_articles(DUMP):
        batch.append(text)
        total += 1
        if len(batch) >= BATCH:
            path = os.path.join(OUT_DIR, f'wiki_{file_idx:04d}')
            with open(path, 'w', encoding='utf-8') as f:
                f.write('\n\n'.join(batch))
            print(f'  wrote {path}  ({total} articles total)')
            batch = []
            file_idx += 1

    if batch:
        path = os.path.join(OUT_DIR, f'wiki_{file_idx:04d}')
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n\n'.join(batch))
        print(f'  wrote {path}  ({total} articles total)')

    print(f'\nDone. {total} articles → {file_idx + 1} files in extracted/AA/')


if __name__ == '__main__':
    main()
