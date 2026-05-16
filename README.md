# uzbek-text-tools

A Python library for Uzbek natural language processing. It converts Uzbek text between Cyrillic and Latin scripts and spell-checks Latin-script Uzbek text against a 513,000-word frequency dictionary built from Uzbek Wikipedia.

## Changelog

### v0.2.0
- **Expanded dictionary:** ~548k words (added CC-100 web corpus on top of Wikipedia)
- **Morphology-aware spell checking:** suffix stripper accepts agglutinated forms like `kitoblarimizdan` without false-flagging them
- **Weighted edit distance:** common Uzbek letter confusions (x/h, i/y, u/o, b/p, d/t) have a reduced substitution cost of 0.5, so phonetically plausible suggestions rank higher
- **Mixed-script input:** new `transliterate_mixed()` function handles strings that contain both Cyrillic and Latin words in a single pass
- **HuggingFace Hub dictionary:** `word_freq.json` is now fetched from `Umid0708/uzbek-word-freq` on first use and cached locally — the wheel is under 100 KB instead of 2.8 MB

### v0.1.0
- Cyrillic↔Latin transliterator (33 Cyrillic letters + 4 Uzbek-specific: Ғ, Қ, Ҳ, Ў)
- Levenshtein spell checker against a 513k-word Wikipedia frequency dictionary
- `UzbekTextPipeline` — transliterate + spell-check in a single call

## Installation

```bash
pip install uzbek-text-tools
```

## Usage

### Transliterator

Convert Uzbek text between Cyrillic and Latin scripts:

```python
from uzbek_text_tools import transliterate

print(transliterate("Салом, дўстлар!"))
# → Salom, doʻstlar!

print(transliterate("Ўзбекистон — буюк давлат."))
# → Oʻzbekiston — buyuk davlat.
```

The class-based interface:

```python
from uzbek_text_tools import Transliterator

t = Transliterator()
print(t.cyrillic_to_latin("Шаҳар"))   # → Shahar
print(t.latin_to_cyrillic("Salom"))   # → Салом
```

**Edge case handled:** `Е/е` at the start of a word becomes `Ye/ye`; in the middle it becomes `E/e`.

```python
transliterate("Европа метро")
# → Yevropa metro
```

### Spell Checker

Check and correct Latin-script Uzbek text:

```python
from uzbek_text_tools import UzbekSpellChecker

sc = UzbekSpellChecker()

# Single word
sc.is_correct("kitob")     # True
sc.is_correct("kitoob")    # False
sc.suggest("kitoob")       # ['kitob']
sc.correct("kitoob")       # 'kitob'

# Full paragraph
result = sc.check_text("Bu kitoob juda yaxshi")
print(result)
# {
#   'total_words': 4,
#   'errors_found': 1,
#   'errors': [{'word': 'kitoob', 'suggestions': ['kitob']}]
# }
```

Suggestions are ranked by Levenshtein distance first, then by word frequency — so common Uzbek words rank above rare ones when equidistant.

### Pipeline (transliterate + spellcheck in one call)

```python
from uzbek_text_tools import UzbekTextPipeline

pipe = UzbekTextPipeline()

# Cyrillic input
result = pipe.process("Бу китооб жуда яхши", script="cyrillic")
print(result["converted"])              # Bu kitoob juda yaxshi
print(result["spell_check"]["errors"])  # [{'word': 'kitoob', 'suggestions': ['kitob']}]

# Latin input (default)
result = pipe.process("Bu kitoob juda yaxshi")
print(result["spell_check"]["errors_found"])  # 1
```

## How it works

| Component | Detail |
|---|---|
| Transliterator | Character-map based; handles all 33 Cyrillic letters + 4 Uzbek-specific letters (`Ғ`, `Қ`, `Ҳ`, `Ў`); word-boundary regex for the `Е→Ye` rule |
| Mixed-script | `transliterate_mixed()` classifies each token by its Cyrillic character ratio (threshold 0.3) and routes it independently |
| Dictionary | ~548k words from Uzbek Wikipedia + CC-100 web corpus, frequency ≥ 3; hosted on HuggingFace Hub, cached locally on first use |
| Stemmer | Rule-based suffix stripper (35 suffixes, longest-first); vowel guard prevents false `-i` matches; up to 3 iterative passes |
| Spell checker | Weighted edit distance ≤ 2 (Uzbek confusion pairs cost 0.5); character-bucket index pre-filters candidates by first char + length (~10–20× fewer comparisons); frequency tiebreaker |

## Benchmark

220 test cases (100 phonetic, 100 double-char, 20 real-user typos).

| Category | Top-1 | Top-3 |
|---|---|---|
| Phonetic confusions | 99.0% | 99.0% |
| Double-char typos | 99.0% | 99.0% |
| Real user typos | 90.0% | 100.0% |
| **Overall** | **98.2%** | **99.1%** |

Run it yourself: `python scripts/evaluate.py`

## Known limitations

These limitations define the honest scope of v0.1. They are not failures — they are the roadmap for v0.2.

**1. Dictionary is primarily formal text.** *(partially resolved in v0.2)*
The frequency dictionary combines Uzbek Wikipedia and CC-100 (web-crawled text). Casual speech, SMS abbreviations, and regional slang are better covered than v0.1 but still underrepresented. A word like `salomat` is recognised; a slang shortening like `slm` is not.

**2. Transliterator handles standard Uzbek only.**
The Cyrillic→Latin mapping covers the official 1995 Uzbek Latin alphabet. Loanwords from Russian, English, or Arabic that use non-standard Cyrillic letters (`Щ`, `Ъ`, `Ы`, `Ь`) are mapped to their closest approximation but may not convert perfectly. Proper nouns transliterated into Cyrillic from other languages are especially likely to look odd after conversion.

**3. Spell checker is word-level only.**
Each word is checked independently against the dictionary. The spell checker has no understanding of grammar, word order, or context. It will not catch correctly-spelled words used in the wrong place (e.g. `men` instead of `men` used as a different part of speech), and it will not suggest grammatically correct replacements — only lexically close ones.

**4. Mixed-script input.** *(resolved in v0.2)*
Use `transliterate_mixed()` for strings that contain both Cyrillic and Latin tokens. The pipeline's `process()` method still expects a single script per call; pass `script="cyrillic"` or `script="latin"` accordingly.

### v0.2 roadmap

| Limitation | Status |
|---|---|
| Wikipedia-only vocabulary | ✅ v0.2 — CC-100 corpus added (~548k words total) |
| Mixed-script input | ✅ v0.2 — `transliterate_mixed()` added |
| Loanword transliteration | 🔜 v0.3 — extend mapping table with known exception list |
| Word-level spell checker | 🔜 v0.3 — n-gram context model for grammar-aware suggestions |
| Speed on long documents | 🔜 v0.3 — replace linear scan with a BK-tree index |

## Contributing

1. Fork the repo on [GitHub](https://github.com/umid150708/uzbek-text-tools)
2. Create a feature branch: `git checkout -b feature/my-improvement`
3. Add or update tests in `tests/`
4. Run the suite: `pytest tests/`
5. Open a pull request

Ideas welcome: broader corpus (social media, news), morphology-aware checking, Latin→Cyrillic spell-check, CLI tool.

## License

MIT
