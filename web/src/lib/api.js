/**
 * api.js  —  thin wrappers around the FastAPI backend
 *
 * In development, Vite proxies /api → http://localhost:8000
 * In production, set VITE_API_URL to the deployed server base URL.
 */

const BASE = import.meta.env.VITE_API_URL ?? ''

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`API ${path} ${res.status}: ${detail}`)
  }
  return res.json()
}

/**
 * Spell-check Latin-script Uzbek text.
 * @returns {{ total_words, errors_found, errors: [{word, start, end, suggestions}] }}
 */
export function checkText(text, topN = 3) {
  return post('/api/check', { text, top_n: topN })
}

/**
 * Transliterate text between scripts.
 * @param {'cyrillic-to-latin'|'latin-to-cyrillic'|'auto'} mode
 * @returns {{ original, converted, mode }}
 */
export function transliterateText(text, mode = 'cyrillic-to-latin') {
  return post('/api/transliterate', { text, mode })
}

/**
 * Combined transliterate + spell-check in one request (used by extension too).
 * @param {'latin'|'cyrillic'} script
 */
export function checkAndTranslit(text, script = 'latin', topN = 3) {
  return post('/api/check-and-translit', { text, script, top_n: topN })
}
