/**
 * background.js  —  service worker
 *
 * Relays API calls from content scripts.  Extension service workers can make
 * cross-origin requests freely; content scripts cannot (CORS blocks them).
 *
 * Messages handled
 * ─────────────────
 * { type: 'CHECK_TEXT',    text, topN? }  → spell-check response
 * { type: 'TRANSLITERATE', text, mode  }  → transliteration response
 * { type: 'GET_API_BASE' }               → returns the saved API base URL
 */

const DEFAULT_API = 'https://uzbek-text-tools-2.onrender.com'

async function getApiBase() {
  const { apiBase } = await chrome.storage.sync.get(['apiBase'])
  return (apiBase || DEFAULT_API).replace(/\/$/, '')
}

async function apiFetch(path, body) {
  const base = await getApiBase()
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API ${res.status} ${path}`)
  return res.json()
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handle = async () => {
    switch (msg.type) {
      case 'CHECK_TEXT':
        return apiFetch('/api/check', { text: msg.text, top_n: msg.topN ?? 3 })
      case 'TRANSLITERATE':
        return apiFetch('/api/transliterate', { text: msg.text, mode: msg.mode })
      case 'GET_API_BASE':
        return { apiBase: await getApiBase() }
      default:
        throw new Error(`Unknown message type: ${msg.type}`)
    }
  }

  handle()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }))

  return true  // keep message channel open for async response
})
