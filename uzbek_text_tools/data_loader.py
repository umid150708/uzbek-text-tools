"""
Dictionary loader with HuggingFace Hub as the primary source and a local
fallback for offline / first-run use.

Download flow
-------------
1. If a cached copy exists at ``~/.cache/uzbek_text_tools/word_freq.json``
   it is loaded directly — no network required on subsequent runs.
2. Otherwise the file is fetched from ``Umid0708/uzbek-word-freq`` on the
   HuggingFace Hub, saved to the cache directory, then returned.
3. If the download fails (no internet, rate-limit, etc.) and the bundled
   ``data/word_freq.json`` still exists in the package directory, it is
   used as a last resort so the library always works offline.
"""

import json
import os
from pathlib import Path

from huggingface_hub import hf_hub_download

# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------
CACHE_PATH    = Path.home() / ".cache" / "uzbek_text_tools" / "word_freq.json"
HF_REPO       = "Umid0708/uzbek-word-freq"
HF_FILENAME   = "word_freq.json"
# Bundled fallback (removed from the wheel in v0.2, kept for dev installs)
_BUNDLED_PATH = Path(__file__).parent / "data" / HF_FILENAME


def load_dictionary() -> dict[str, int]:
    """
    Return the word-frequency dictionary as ``{word: freq}`` mapping.

    Tries, in order:
    1. Local cache (``~/.cache/uzbek_text_tools/word_freq.json``)
    2. HuggingFace Hub  (``Umid0708/uzbek-word-freq``)
    3. Bundled copy inside the package (fallback / dev mode)

    Raises ``FileNotFoundError`` only if all three sources are unavailable.
    """
    # ── 1. Warm cache ────────────────────────────────────────────────────────
    if CACHE_PATH.exists():
        with open(CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)

    # ── 2. HuggingFace Hub ───────────────────────────────────────────────────
    try:
        print("Downloading Uzbek dictionary (first use only)...")
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        downloaded = hf_hub_download(
            repo_id=HF_REPO,
            filename=HF_FILENAME,
            repo_type="dataset",
            local_dir=str(CACHE_PATH.parent),
        )
        # hf_hub_download may save to a nested snapshot path; normalise to
        # CACHE_PATH so future runs find it at the expected location.
        src = Path(downloaded)
        if src.resolve() != CACHE_PATH.resolve():
            import shutil
            shutil.copy2(src, CACHE_PATH)
        with open(CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print(f"  Hub download failed ({exc}); trying bundled copy...")

    # ── 3. Bundled fallback ──────────────────────────────────────────────────
    if _BUNDLED_PATH.exists():
        with open(_BUNDLED_PATH, encoding="utf-8") as f:
            return json.load(f)

    raise FileNotFoundError(
        "Could not load the Uzbek word-frequency dictionary.\n"
        "  • Cached copy  : not found at " + str(CACHE_PATH) + "\n"
        "  • HuggingFace  : download failed (see above)\n"
        "  • Bundled copy : not found at " + str(_BUNDLED_PATH) + "\n"
        "Run with internet access once to cache the dictionary, or reinstall "
        "the package."
    )
