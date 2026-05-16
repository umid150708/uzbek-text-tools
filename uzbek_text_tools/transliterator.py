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
