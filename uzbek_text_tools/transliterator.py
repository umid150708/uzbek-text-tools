class Transliterator:
    """Convert Uzbek text between Cyrillic and Latin scripts."""

    CYRILLIC_TO_LATIN = {
        "А": "A", "а": "a", "Б": "B", "б": "b", "В": "V", "в": "v",
        "Г": "G", "г": "g", "Д": "D", "д": "d", "Е": "Ye", "е": "ye",
        "Ё": "Yo", "ё": "yo", "Ж": "J", "ж": "j", "З": "Z", "з": "z",
        "И": "I", "и": "i", "Й": "Y", "й": "y", "К": "K", "к": "k",
        "Л": "L", "л": "l", "М": "M", "м": "m", "Н": "N", "н": "n",
        "О": "O", "о": "o", "П": "P", "п": "p", "Р": "R", "р": "r",
        "С": "S", "с": "s", "Т": "T", "т": "t", "У": "U", "у": "u",
        "Ф": "F", "ф": "f", "Х": "X", "х": "x", "Ц": "Ts", "ц": "ts",
        "Ч": "Ch", "ч": "ch", "Ш": "Sh", "ш": "sh", "Щ": "Sh", "щ": "sh",
        "Ъ": "'", "ъ": "'", "Ы": "I", "ы": "i", "Ь": "", "ь": "",
        "Э": "E", "э": "e", "Ю": "Yu", "ю": "yu", "Я": "Ya", "я": "ya",
        "Ғ": "Gʻ", "ғ": "gʻ", "Қ": "Q", "қ": "q", "Ҳ": "H", "ҳ": "h",
        "Ў": "Oʻ", "ў": "oʻ",
    }

    LATIN_TO_CYRILLIC = {v: k for k, v in CYRILLIC_TO_LATIN.items() if v}

    def cyrillic_to_latin(self, text: str) -> str:
        result = []
        for char in text:
            result.append(self.CYRILLIC_TO_LATIN.get(char, char))
        return "".join(result)

    def latin_to_cyrillic(self, text: str) -> str:
        result = text
        for lat, cyr in sorted(self.LATIN_TO_CYRILLIC.items(), key=lambda x: -len(x[0])):
            result = result.replace(lat, cyr)
        return result
