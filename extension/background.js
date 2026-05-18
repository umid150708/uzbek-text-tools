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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = async () => {
    switch (msg.type) {
      case 'CHECK_TEXT':
        return apiFetch('/api/check', { text: msg.text, top_n: msg.topN ?? 3 })
      case 'TRANSLITERATE':
        return apiFetch('/api/transliterate', { text: msg.text, mode: msg.mode })
      case 'GET_API_BASE':
        return { apiBase: await getApiBase() }
      case 'EXTRACT_DOCS_TEXT':
        return extractDocsText(sender.tab?.id)
      default:
        throw new Error(`Unknown message type: ${msg.type}`)
    }
  }

  handle()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }))

  return true  // keep message channel open for async response
})

/**
 * Inject a function into the Google Docs page context (world: MAIN)
 * using chrome.scripting.executeScript. This bypasses CSP restrictions
 * and can access the same DOM that Google Docs' own JS sees.
 */
async function extractDocsText(tabId) {
  if (!tabId) throw new Error('No tab ID')

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      try {
        const SKIP = '#uz-docs-sidebar, #uz-docs-fab'
        const results = {}

        // Method A: innerText from editor (in page context, innerText may
        // return text that content-script world can't see)
        const editorSels = [
          '.kix-appview-editor',
          '.kix-page',
          '.kix-page-content-wrapper',
          '[role="textbox"]',
          '[role="main"]',
          '[role="document"]',
        ]
        for (const sel of editorSels) {
          const el = document.querySelector(sel)
          if (!el || el.closest(SKIP)) continue
          const t = (el.innerText || '').trim()
          if (t.length > 20) {
            results.innerText = { sel, text: t }
            break
          }
        }

        // Method B: textContent on page containers
        for (const sel of ['.kix-page-content-wrapper', '.kix-page', '[data-page-index]']) {
          const els = document.querySelectorAll(sel)
          if (!els.length) continue
          let combined = ''
          for (const el of els) {
            if (el.closest(SKIP)) continue
            combined += ' ' + (el.textContent || '')
          }
          combined = combined.trim()
          if (combined.length > 20) {
            results.pageText = { sel, text: combined }
            break
          }
        }

        // Method C: aria-label attributes inside editor
        const editor = document.querySelector('.kix-appview-editor') ||
                       document.querySelector('[role="main"]')
        if (editor) {
          const labels = []
          for (const el of editor.querySelectorAll('[aria-label]')) {
            if (el.closest(SKIP)) continue
            const lbl = el.getAttribute('aria-label')
            if (lbl && lbl.length > 3) labels.push(lbl)
          }
          if (labels.length) results.ariaLabels = labels.join(' ')
        }

        // Method D: TreeWalker for all text nodes in editor
        if (editor) {
          const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
          const parts = []
          const seen = new Set()
          let node
          while ((node = walker.nextNode())) {
            if (node.parentElement?.closest(SKIP)) continue
            const t = (node.textContent || '').trim()
            if (t.length > 1 && !seen.has(t)) { seen.add(t); parts.push(t) }
          }
          if (parts.length) results.treeWalker = parts.join(' ')
        }

        // Method E: try selecting all text and reading selection
        try {
          const sel = window.getSelection()
          const savedRanges = []
          for (let i = 0; i < sel.rangeCount; i++) savedRanges.push(sel.getRangeAt(i).cloneRange())

          document.execCommand('selectAll', false, null)
          const selText = (sel.toString() || '').trim()
          if (selText.length > 10) results.selection = selText

          // Restore original selection
          sel.removeAllRanges()
          for (const r of savedRanges) sel.addRange(r)
        } catch {}

        // Pick the best non-toolbar text
        // Priority: selection > ariaLabels > pageText > treeWalker > innerText
        const candidates = [
          results.selection,
          results.ariaLabels,
          results.pageText?.text,
          results.treeWalker,
          results.innerText?.text,
        ]

        // Diagnostic info
        const diag = {
          selection: (results.selection || '').length,
          ariaLabels: (results.ariaLabels || '').length,
          pageText: (results.pageText?.text || '').length,
          treeWalker: (results.treeWalker || '').length,
          innerText: (results.innerText?.text || '').length,
        }

        let best = ''
        let source = 'none'
        const names = ['selection', 'ariaLabels', 'pageText', 'treeWalker', 'innerText']
        for (let i = 0; i < candidates.length; i++) {
          const val = (candidates[i] || '').trim()
          if (val.length > best.length) { best = val; source = names[i] }
        }

        return { text: best.substring(0, 10000), source, diag }
      } catch (e) {
        return { text: '', source: 'error', diag: { error: e.message } }
      }
    },
  })

  return results[0]?.result || { text: '', source: 'error', diag: {} }
}
