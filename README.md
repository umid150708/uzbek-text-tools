# uzbek-text-tools

A Python library for Uzbek natural language processing. It converts Uzbek text between Cyrillic and Latin scripts and spell-checks Latin-script Uzbek text against a 513,000-word frequency dictionary built from Uzbek Wikipedia.

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
| Dictionary | 513,409 words extracted from Uzbek Wikipedia (675 article batches), frequency ≥ 3 |
| Spell checker | Levenshtein distance ≤ 2, with length-window pre-filter (±2 chars) for speed; frequency as tiebreaker |

## Known limitations

These limitations define the honest scope of v0.1. They are not failures — they are the roadmap for v0.2.

**1. Dictionary is based on Wikipedia.**
The 513,000-word frequency dictionary was extracted from Uzbek Wikipedia. Wikipedia is formal, encyclopaedic text. Informal words, slang, SMS abbreviations, and everyday casual speech are underrepresented. A word like `salomat` will be recognised; a slang shortening like `slm` will not. Future versions will supplement the corpus with social-media and news text.

**2. Transliterator handles standard Uzbek only.**
The Cyrillic→Latin mapping covers the official 1995 Uzbek Latin alphabet. Loanwords from Russian, English, or Arabic that use non-standard Cyrillic letters (`Щ`, `Ъ`, `Ы`, `Ь`) are mapped to their closest approximation but may not convert perfectly. Proper nouns transliterated into Cyrillic from other languages are especially likely to look odd after conversion.

**3. Spell checker is word-level only.**
Each word is checked independently against the dictionary. The spell checker has no understanding of grammar, word order, or context. It will not catch correctly-spelled words used in the wrong place (e.g. `men` instead of `men` used as a different part of speech), and it will not suggest grammatically correct replacements — only lexically close ones.

**4. Does not handle mixed-script text.**
A sentence that contains both Cyrillic and Latin characters in the same string (e.g. `Toshkent шаҳри`) is not supported. The pipeline expects input to be entirely one script. Pass `script="cyrillic"` for fully Cyrillic input or `script="latin"` for fully Latin input. Mixed input will produce incorrect transliteration or missed spell-check coverage.

### v0.2 roadmap

| Limitation | Planned fix |
|---|---|
| Wikipedia-only vocabulary | Add Telegram channels, news sites, and social-media corpora |
| Loanword transliteration | Extend mapping table with known exception list |
| Word-level spell checker | Add n-gram context model for grammar-aware suggestions |
| Mixed-script input | Detect script per token and route each word independently |
| Speed on long documents | Replace linear scan with a BK-tree index |

## Contributing

1. Fork the repo on [GitHub](https://github.com/umid150708/uzbek-text-tools)
2. Create a feature branch: `git checkout -b feature/my-improvement`
3. Add or update tests in `tests/`
4. Run the suite: `pytest tests/`
5. Open a pull request

Ideas welcome: broader corpus (social media, news), morphology-aware checking, Latin→Cyrillic spell-check, CLI tool.

## License

MIT
