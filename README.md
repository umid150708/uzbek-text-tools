# UzbekTextTools

A Python toolkit for Uzbek natural language processing.

## Features
- **Transliterator** — convert between Uzbek Cyrillic and Latin scripts
- **SpellChecker** — frequency-based spellchecker with Levenshtein suggestions
- **Pipeline** — combined transliteration + spellcheck in one call
- **Gradio demo** — interactive web UI

## Installation

```bash
python -m venv venv
source venv/bin/activate  # Mac/Linux
venv\Scripts\activate     # Windows

pip install -r requirements.txt
pip install -e .
```

## Quick start

```python
from uzbek_text_tools import Transliterator, SpellChecker

t = Transliterator()
print(t.cyrillic_to_latin("Салом"))  # → Salom

sc = SpellChecker()
print(sc.correct("salm"))            # → salom
```

## Run tests

```bash
pytest tests/
```

## Run demo

```bash
python demo/app.py
```
