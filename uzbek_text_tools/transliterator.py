import re

CYR_TO_LAT = {
    'А': 'A',  'а': 'a',
    'Б': 'B',  'б': 'b',
    'В': 'V',  'в': 'v',
    'Г': 'G',  'г': 'g',
    'Д': 'D',  'д': 'd',
    'Е': 'E',  'е': 'e',   # word-initial Ye handled separately
    'Ё': 'Yo', 'ё': 'yo',
    'Ж': 'J',  'ж': 'j',
    'З': 'Z',  'з': 'z',
    'И': 'I',  'и': 'i',
    'Й': 'Y',  'й': 'y',
    'К': 'K',  'к': 'k',
    'Л': 'L',  'л': 'l',
    'М': 'M',  'м': 'm',
    'Н': 'N',  'н': 'n',
    'О': 'O',  'о': 'o',
    'П': 'P',  'п': 'p',
    'Р': 'R',  'р': 'r',
    'С': 'S',  'с': 's',
    'Т': 'T',  'т': 't',
    'У': 'U',  'у': 'u',
    'Ф': 'F',  'ф': 'f',
    'Х': 'X',  'х': 'x',
    'Ц': 'Ts', 'ц': 'ts',
    'Ч': 'Ch', 'ч': 'ch',
    'Ш': 'Sh', 'ш': 'sh',
    'Щ': 'Sh', 'щ': 'sh',
    'Ъ': "'",  'ъ': "'",
    'Ы': 'I',  'ы': 'i',
    'Ь': '',   'ь': '',
    'Э': 'E',  'э': 'e',
    'Ю': 'Yu', 'ю': 'yu',
    'Я': 'Ya', 'я': 'ya',
    # Uzbek-specific letters
    'Ҳ': 'H',   'ҳ': 'h',
    'Қ': 'Q',   'қ': 'q',
    'Ғ': "Gʻ",  'ғ': "gʻ",
    'Ў': "Oʻ",  'ў': "oʻ",
    # Digraph sequences handled via pre-processing
    'Нг': 'Ng', 'нг': 'ng',
}


def transliterate(text: str) -> str:
    """Convert Uzbek Cyrillic text to Latin script."""
    # Е/е at word boundary → Ye/ye; mid-word → E/e (already in dict)
    text = re.sub(r'\bЕ', 'Ye', text)
    text = re.sub(r'\bе', 'ye', text)

    # Нг/нг → Ng/ng before character-by-character pass
    text = text.replace('Нг', 'Ng').replace('нг', 'ng')

    result = []
    for char in text:
        result.append(CYR_TO_LAT.get(char, char))
    return ''.join(result)


# ---------------------------------------------------------------------------
# Mixed-script support
# ---------------------------------------------------------------------------

def detect_token_script(token: str) -> str:
    """
    Return ``"cyrillic"`` if more than 30 % of the token's characters fall
    in the Cyrillic Unicode block (U+0400–U+04FF), otherwise ``"latin"``.

    The 0.3 threshold handles tokens that mix a Cyrillic root with Latin
    punctuation or digits without misclassifying purely Latin tokens.
    """
    cyrillic_chars = sum(1 for c in token if 'Ѐ' <= c <= 'ӿ')
    ratio = cyrillic_chars / max(len(token), 1)
    return "cyrillic" if ratio > 0.3 else "latin"


def transliterate_mixed(text: str) -> str:
    """
    Transliterate a string that contains *both* Cyrillic and Latin words.

    Each token is classified independently by :func:`detect_token_script`.
    Cyrillic tokens are converted to Latin via :func:`transliterate`;
    Latin tokens (and whitespace / punctuation) are passed through unchanged.

    Example::

        >>> transliterate_mixed("Bu kitob очень яхши — maktabda o'qiladi")
        "Bu kitob ochen yaxshi — maktabda o'qiladi"
    """
    # Split on whitespace / punctuation runs, keeping the separators so the
    # output can be reassembled without losing any spacing or punctuation.
    tokens = re.split(r'(\s+|[^\w]+)', text)
    result = []
    for token in tokens:
        if not token or not token.strip():
            # Whitespace or empty segment — pass through as-is
            result.append(token)
            continue
        if detect_token_script(token) == "cyrillic":
            result.append(transliterate(token))
        else:
            result.append(token)
    return "".join(result)


class Transliterator:
    """Object-oriented wrapper around the module-level transliterate function."""

    def cyrillic_to_latin(self, text: str) -> str:
        return transliterate(text)

    def latin_to_cyrillic(self, text: str) -> str:
        LAT_TO_CYR = {v: k for k, v in CYR_TO_LAT.items() if v}
        result = text
        for lat, cyr in sorted(LAT_TO_CYR.items(), key=lambda x: -len(x[0])):
            result = result.replace(lat, cyr)
        return result
