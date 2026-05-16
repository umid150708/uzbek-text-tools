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

- **Formal vocabulary only.** The dictionary comes from Wikipedia — everyday slang, SMS language, and casual speech may be flagged as errors even when correct.
- **Latin script only for spell-checking.** Run Cyrillic text through the transliterator first (or use the `Pipeline`).
- **No morphological analysis.** Uzbek is an agglutinative language; word forms like `kitoblar` (books) and `kitoblarni` (books, accusative) are treated as independent entries. Rare inflected forms may not be in the dictionary.
- **Speed.** Checking a long document takes a few seconds because each unknown word is compared against up to ~50,000 length-similar candidates. A BK-tree index is planned for v0.2.

## Contributing

1. Fork the repo on [GitHub](https://github.com/umid150708/uzbek-text-tools)
2. Create a feature branch: `git checkout -b feature/my-improvement`
3. Add or update tests in `tests/`
4. Run the suite: `pytest tests/`
5. Open a pull request

Ideas welcome: broader corpus (social media, news), morphology-aware checking, Latin→Cyrillic spell-check, CLI tool.

## License

MIT
