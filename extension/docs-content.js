/**
 * docs-content.js  —  Google Docs specific content script  (Approach A)
 *
 * Google Docs renders text on a canvas-based engine, so the normal
 * contenteditable approach does not work.  Instead:
 *
 *   READ  — extract text from the accessibility tree (.kix-lineview-text-block
 *           elements, which Docs keeps in sync for screen readers).
 *
 *   SHOW  — display errors in a fixed sidebar panel, not inline underlines.
 *
 *   APPLY — use document.execCommand('insertText') after programmatically
 *           selecting the word via the Docs keyboard shortcut flow.
 *           This is the standard Approach A limitation: correction works best
 *           when the cursor is already near the word.
 *
 * Known limitation: word selection before replacement is approximate.
 * Google Docs API (OAuth) would give exact control — that is v0.3.
 */

'use strict'

const DEBOUNCE_MS = 900

let debounceTimer = null
let sidebarEl     = null

// ── Read document text from accessibility tree ────────────────────────────────
function readDocsText() {
  // Primary: individual text blocks used by screen readers
  const blocks = document.querySelectorAll('.kix-lineview-text-block')
  if (blocks.length) {
    return Array.from(blocks)
      .map((b) => b.textContent)
      .join('\n')
      .trim()
  }
  // Fallback: aria-live region inside the docs iframe
  const iframe = document.querySelector('.docs-texteventtarget-iframe')
  if (iframe) {
    try { return iframe.contentDocument?.body?.innerText?.trim() ?? null }
    catch { /* cross-origin guard */ }
  }
  return null
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function getOrCreateSidebar() {
  if (sidebarEl && document.body.contains(sidebarEl)) return sidebarEl

  sidebarEl = document.createElement('div')
  sidebarEl.id = 'uz-docs-sidebar'

  const header = document.createElement('div')
  header.className = 'uz-docs-header'
  header.innerHTML = '<span class="uz-docs-title"><b>O\'z</b>Tekshiruv</span>'

  const closeBtn = document.createElement('button')
  closeBtn.className = 'uz-docs-close'
  closeBtn.textContent = '✕'
  closeBtn.title = 'Yopish'
  closeBtn.onclick = () => { sidebarEl.remove(); sidebarEl = null }
  header.appendChild(closeBtn)

  const body = document.createElement('div')
  body.className = 'uz-docs-body'

  sidebarEl.appendChild(header)
  sidebarEl.appendChild(body)
  document.body.appendChild(sidebarEl)

  return sidebarEl
}

function renderSidebar(errors, totalWords) {
  const sidebar  = getOrCreateSidebar()
  const body     = sidebar.querySelector('.uz-docs-body')
  body.innerHTML = ''

  if (!errors.length) {
    const ok = document.createElement('div')
    ok.className   = 'uz-docs-clear'
    ok.textContent = `✓ Xatolar topilmadi  (${totalWords} so'z)`
    body.appendChild(ok)
    return
  }

  const stats = document.createElement('div')
  stats.className   = 'uz-docs-stats'
  stats.textContent = `${errors.length} xato · ${totalWords} so'z`
  body.appendChild(stats)

  const list = document.createElement('ul')
  list.className = 'uz-docs-errors'

  for (const err of errors) {
    const item = document.createElement('li')
    item.className = 'uz-docs-error-item'

    const wordEl = document.createElement('span')
    wordEl.className   = 'uz-docs-error-word'
    wordEl.textContent = err.word
    item.appendChild(wordEl)

    const chips = document.createElement('div')
    chips.className = 'uz-docs-chips'
    for (const sug of err.suggestions) {
      const btn = document.createElement('button')
      btn.className   = 'uz-docs-chip'
      btn.textContent = sug
      btn.addEventListener('click', () => applyCorrection(err.word, sug))
      chips.appendChild(btn)
    }
    item.appendChild(chips)
    list.appendChild(item)
  }

  body.appendChild(list)
}

// ── Apply correction ──────────────────────────────────────────────────────────
function applyCorrection(misspelled, suggestion) {
  /**
   * Strategy (Approach A):
   *  1. Focus the Docs editor surface.
   *  2. Use Ctrl+H (Find & Replace) to replace the exact misspelled word.
   *     This is reliable because it doesn't require knowing cursor position.
   *
   * A more seamless approach (clicking the exact word) would require the
   * Google Docs API — deferred to v0.3.
   */
  const editor = document.querySelector('.kix-appview-editor')
  if (!editor) return

  // Trigger Find & Replace: Ctrl+H
  editor.focus()
  editor.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'h', keyCode: 72, ctrlKey: true, bubbles: true, cancelable: true,
  }))

  // Wait for the dialog to open, then fill it programmatically
  setTimeout(() => {
    // Docs Find & Replace dialog inputs
    const inputs = document.querySelectorAll('.docs-findreplacebutton-container input, .modal-dialog input[type="text"]')
    if (inputs.length >= 2) {
      inputs[0].value = misspelled   // "Find" field
      inputs[1].value = suggestion   // "Replace with" field
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      // Click "Replace all"
      setTimeout(() => {
        const replaceAllBtn = document.querySelector(
          '[aria-label="Replace all"], .modal-dialog button:last-of-type'
        )
        replaceAllBtn?.click()
        // Close dialog
        setTimeout(() => {
          document.querySelector('[aria-label="Close"], .modal-dialog .close-button')?.click()
        }, 300)
      }, 200)
    }
  }, 400)
}

// ── Watch for keystrokes in the Docs editor ────────────────────────────────────
document.addEventListener(
  'keyup',
  () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      const text = readDocsText()
      if (!text || text.length < 3) return

      try {
        const res = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'CHECK_TEXT', text }, (r) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
            if (r?.error) return reject(new Error(r.error))
            resolve(r)
          })
        })
        renderSidebar(res.errors ?? [], res.total_words ?? 0)
      } catch (err) {
        console.debug('[OʻzTekshiruv] check failed:', err.message)
      }
    }, DEBOUNCE_MS)
  },
  true,  // capture phase — Docs stops propagation early
)
