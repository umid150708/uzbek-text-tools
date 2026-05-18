"""
uzbek-text-tools  —  FastAPI backend
=====================================
Endpoints
---------
POST /api/check
    Spell-check Latin-script Uzbek text.
    Returns errors with character offsets (start/end) and top-3 suggestions.

POST /api/transliterate
    Convert text between Cyrillic and Latin scripts.

POST /api/check-and-translit
    Transliterate (if needed) then spell-check in one round trip.
    Used by the browser extension to avoid two sequential requests.

Health
------
GET /healthz   — returns {"status": "ok"}
"""

from __future__ import annotations

import re
import sys
import os
from contextlib import asynccontextmanager

# Allow running from project root:  python api/main.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from uzbek_text_tools.spellchecker import get_checker, _normalise_apo
from uzbek_text_tools.transliterator import transliterate, transliterate_mixed
from uzbek_text_tools.tokenizer import _TOKEN_RE, _WORD_START

# ---------------------------------------------------------------------------
# Spell checker singleton — loaded once at startup
# ---------------------------------------------------------------------------
_checker = None


def get_spell_checker():
    global _checker
    if _checker is None:
        _checker = get_checker()
    return _checker


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-warm the spell checker so the first request isn't slow."""
    get_spell_checker()
    yield


# ---------------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------------
app = FastAPI(
    title="uzbek-text-tools API",
    version="0.2.0",
    description="Spell-check and transliterate Latin-script Uzbek text.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # extension calls from any origin
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class CheckRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10_000,
                      description="Latin-script Uzbek text to spell-check")
    top_n: int = Field(3, ge=1, le=10,
                       description="Number of suggestions per error (default 3)")


class ErrorSpan(BaseModel):
    word: str
    start: int = Field(..., description="Start char index in the input text")
    end: int = Field(..., description="Exclusive end char index in the input text")
    suggestions: list[str]


class CheckResponse(BaseModel):
    total_words: int
    errors_found: int
    errors: list[ErrorSpan]


class TranslitRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10_000)
    mode: str = Field(
        "cyrillic-to-latin",
        description='"cyrillic-to-latin" or "latin-to-cyrillic" or "auto"',
    )


class TranslitResponse(BaseModel):
    original: str
    converted: str
    mode: str


class CheckAndTranslitRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10_000)
    script: str = Field(
        "latin",
        description='"latin" (default, skip transliteration) or "cyrillic"',
    )
    top_n: int = Field(3, ge=1, le=10)


class CheckAndTranslitResponse(BaseModel):
    original: str
    converted: str
    total_words: int
    errors_found: int
    errors: list[ErrorSpan]


# ---------------------------------------------------------------------------
# Helper: tokenise with character offsets
# ---------------------------------------------------------------------------

def _word_spans(text: str) -> list[tuple[str, int, int]]:
    """
    Return (word, start, end) tuples for every WORD token in *text*.
    Uses the same regex as the library tokeniser so apostrophe-phonemes
    (o', g') are never split.
    """
    spans = []
    for m in _TOKEN_RE.finditer(text):
        token = m.group()
        if _WORD_START.match(token):
            spans.append((token, m.start(), m.end()))
    return spans


def _check_text_with_offsets(text: str, top_n: int = 3) -> CheckResponse:
    """
    Core logic shared by /api/check and /api/check-and-translit.
    Runs the spell-checker and enriches each error with start/end offsets.
    """
    checker = get_spell_checker()
    spans = _word_spans(text)

    errors: list[ErrorSpan] = []
    for word, start, end in spans:
        if not checker.is_correct(word):
            suggestions = checker.suggest(word, top_n=top_n)
            errors.append(ErrorSpan(
                word=word,
                start=start,
                end=end,
                suggestions=suggestions,
            ))

    return CheckResponse(
        total_words=len(spans),
        errors_found=len(errors),
        errors=errors,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/healthz", tags=["meta"])
def health():
    return {"status": "ok"}


@app.post("/api/check", response_model=CheckResponse, tags=["spellcheck"])
def check(req: CheckRequest):
    """
    Spell-check Latin-script Uzbek text.

    Each error in the response includes:
    - `word`        — the misspelled token as it appears in the input
    - `start`/`end` — character indices (end is exclusive), suitable for
                      positioning underlines in a browser extension
    - `suggestions` — up to `top_n` ranked correction candidates
    """
    return _check_text_with_offsets(req.text, top_n=req.top_n)


@app.post("/api/transliterate", response_model=TranslitResponse, tags=["transliterate"])
def translit(req: TranslitRequest):
    """
    Convert text between Cyrillic and Latin scripts.

    Modes:
    - `cyrillic-to-latin` — standard Uzbek Cyrillic → 1995 Latin alphabet
    - `latin-to-cyrillic` — reverse direction
    - `auto`              — detect per-token (mixed-script input)
    """
    mode = req.mode.lower().strip()
    if mode == "cyrillic-to-latin":
        converted = transliterate(req.text)
    elif mode == "latin-to-cyrillic":
        from uzbek_text_tools.transliterator import Transliterator
        converted = Transliterator().latin_to_cyrillic(req.text)
    elif mode == "auto":
        converted = transliterate_mixed(req.text)
    else:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown mode {req.mode!r}. "
                   f"Use 'cyrillic-to-latin', 'latin-to-cyrillic', or 'auto'.",
        )

    return TranslitResponse(original=req.text, converted=converted, mode=mode)


@app.post("/api/check-and-translit",
          response_model=CheckAndTranslitResponse,
          tags=["spellcheck", "transliterate"])
def check_and_translit(req: CheckAndTranslitRequest):
    """
    One-shot endpoint for the browser extension: transliterate (if needed)
    then spell-check. Saves one network round trip compared to calling both
    endpoints separately.
    """
    if req.script == "cyrillic":
        converted = transliterate(req.text)
    elif req.script == "latin":
        converted = req.text
    else:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown script {req.script!r}. Use 'latin' or 'cyrillic'.",
        )

    result = _check_text_with_offsets(converted, top_n=req.top_n)

    return CheckAndTranslitResponse(
        original=req.text,
        converted=converted,
        total_words=result.total_words,
        errors_found=result.errors_found,
        errors=result.errors,
    )


# ---------------------------------------------------------------------------
# Dev entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
