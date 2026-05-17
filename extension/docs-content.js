/**
 * docs-content.js  —  Google Docs content script
 *
 * Key fixes vs previous version
 * ──────────────────────────────
 * 1. isLikelyUzbek() — Google Docs auto-converts straight apostrophes to
 *    curly RIGHT SINGLE QUOTATION MARK (U+2019).  The old regex only checked
 *    for basic ASCII `'` so it ALWAYS returned false for real Docs text.
 *    Now uses explicit Unicode escapes for all variants.
 *
 * 2. readDocsText() — tries 5 selectors in order of reliability so we
 *    survive across Google Docs DOM versions.
 *
 * 3. Auto-trigger uses setInterval polling (200 ms) in addition to
 *    MutationObserver + timeout fallbacks — handles the async Docs loader
 *    without relying on observer firing at exactly the right moment.
 *
 * 4. Handles CHECK_NOW message from the popup's "Hozir tekshirish" button.
 */

'use strict'

const DEBOUNCE_MS = 900

// ── State ─────────────────────────────────────────────────────────────────────
let debounceTimer  = null
let sidebarEl      = null
let ignoredKeys    = new Set()
let lastErrors     = []
let lastTotal      = 0
let autoCheckDone  = false
let pollTimer      = null

// ── Language detection ────────────────────────────────────────────────────────
/**
 * Returns true when text is likely Latin-script Uzbek.
 *
 * BUG FIXED: Google Docs auto-converts `'` (U+0027) to `'` (U+2019 RIGHT
 * SINGLE QUOTATION MARK).  Previous regex missed U+2019 entirely so every
 * real Google Docs file scored 0 and the check was silently skipped.
 *
 * Apostrophe variants handled:
 *   U+0027  APOSTROPHE                  (keyboard / plain text)
 *   U+2018  LEFT SINGLE QUOTATION MARK  (rare)
 *   U+2019  RIGHT SINGLE QUOTATION MARK (Google Docs default!) ← was missing
 *   U+02BB  MODIFIER LETTER TURNED COMMA
 *   U+02BC  MODIFIER LETTER APOSTROPHE
 */
function isLikelyUzbek(text) {
  if (!text) return false
  if (text.replace(/\s/g, '').length < 15) return true  // too short — try anyway

  // Cyrillic → our checker is Latin-only
  if (/[Ѐ-ӿ]/.test(text)) return false

  const t = text.toLowerCase()

  // o' / g' in ANY apostrophe variant — including Google Docs curly quotes
  const APO = '['‘’ʻʼ]'
  if (new RegExp('[og]' + APO).test(t)) return true

  // ≥2 high-frequency Uzbek function words
  const WORDS = /\b(va|bu|bir|biz|siz|ular|men|sen|bor|ham|lekin|ammo|uchun|bilan|keyin|oldin|emas|chunki|hali|endi|nima|kim|qayda|yerda|qanday|qachon|shunday|bunday|agar|faqat|hech|juda|eng)\b/g
  if ((t.match(WORDS) || []).length >= 2) return true

  // Uzbek digraph density
  const words    = (t.match(/\b\w+\b/g) || []).length
  const digraphs = (t.match(/sh|ch|ng/g) || []).length
  if (words >= 5 && digraphs / words > 0.3) return true

  return false
}

// ── Read document text ────────────────────────────────────────────────────────
/**
 * Tries five strategies in order of precision.
 * Returns the best non-empty result, or null if the editor hasn't loaded yet.
 */
function readDocsText() {
  // 1. Individual text blocks (screen-reader accessibility nodes)
  const blocks = document.querySelectorAll('.kix-lineview-text-block')
  if (blocks.length > 0) {
    const t = Array.from(blocks).map(b => b.textContent).join('\n').trim()
    if (t.length > 5) return t
  }

  // 2. Word-level nodes (finer granularity, available in most Docs versions)
  const wordNodes = document.querySelectorAll('.kix-wordhtmlgenerator-word-node')
  if (wordNodes.length > 0) {
    const t = Array.from(wordNodes).map(w => w.textContent).join('').trim()
    if (t.length > 5) return t
  }

  // 3. Paragraph containers
  const paras = document.querySelectorAll('[class*="kix-paragraph"]')
  if (paras.length > 0) {
    const t = Array.from(paras).map(p => p.textContent).join('\n').trim()
    if (t.length > 5) return t
  }

  // 4. The whole editor surface (broad but reliable if above fail)
  const editor = document.querySelector('.kix-appview-editor, .docs-editor-container')
  if (editor) {
    const t = editor.innerText?.trim()
    if (t && t.length > 5) return t
  }

  // 5. Iframe fallback
  try {
    const iframe = document.querySelector('.docs-texteventtarget-iframe')
    const t = iframe?.contentDocument?.body?.innerText?.trim()
    if (t && t.length > 5) return t
  } catch { /* cross-origin guard */ }

  return null
}

// ── Background relay ──────────────────────────────────────────────────────────
function callBg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      if (r?.error) return reject(new Error(r.error))
      resolve(r)
    })
  })
}

// ── Category helper ───────────────────────────────────────────────────────────
function getCategory(word, suggestion) {
  const norm = s => s.toLowerCase().replace(/['‘’ʻʼ]/g, "'")
  const w = norm(word), s = norm(suggestion)
  if (w.replace(/'/g, '') === s.replace(/'/g, '')) return 'Apostrof belgisi'
  if (Math.abs(w.length - s.length) > 3) return "To'liqsiz so'z"
  return 'Imlo xatosi'
}

// ── Core check function ───────────────────────────────────────────────────────
async function runCheck(text) {
  if (!text || text.length < 3) return

  if (!isLikelyUzbek(text)) {
    if (sidebarEl && document.body.contains(sidebarEl)) {
      const body = sidebarEl.querySelector('.uz-docs-body')
      if (body) {
        body.innerHTML = ''
        const msg = document.createElement('div')
        msg.className   = 'uz-docs-lang-notice'
        msg.textContent = "O'zbek matni aniqlanmadi. Kirill yozuvini lotin yozuviga o'tkazing yoki o'zbek matni kiriting."
        body.appendChild(msg)
      }
    }
    return
  }

  showLoadingSidebar()

  try {
    const res = await callBg({ type: 'CHECK_TEXT', text })
    ignoredKeys = new Set()
    renderSidebar(res.errors ?? [], res.total_words ?? 0)
  } catch (err) {
    console.debug('[OʻzTekshiruv] check failed:', err.message)
    showErrorSidebar(err.message)
  }
}

// ── Sidebar builders ──────────────────────────────────────────────────────────
function getOrCreateSidebar() {
  if (sidebarEl && document.body.contains(sidebarEl)) return sidebarEl
  sidebarEl = document.createElement('div')
  sidebarEl.id = 'uz-docs-sidebar'
  document.body.appendChild(sidebarEl)
  return sidebarEl
}

function showLoadingSidebar() {
  const sidebar = getOrCreateSidebar()
  sidebar.innerHTML = `
    <div class="uz-docs-header">
      <div class="uz-docs-title-row">
        <span class="uz-docs-title"><b>O'z</b>Tekshiruv</span>
        <button class="uz-docs-close" title="Yopish">✕</button>
      </div>
    </div>
    <div class="uz-docs-body">
      <div class="uz-docs-loading">
        <span class="uz-docs-spinner"></span>
        <span>Tekshirilmoqda…</span>
      </div>
    </div>
  `
  sidebar.querySelector('.uz-docs-close').onclick = () => {
    sidebarEl.remove()
    sidebarEl = null
  }
}

function showErrorSidebar(msg) {
  const sidebar = getOrCreateSidebar()
  const body = sidebar.querySelector('.uz-docs-body')
  if (body) {
    body.innerHTML = `<div class="uz-docs-lang-notice">❌ Xato: ${msg}</div>`
  }
}

function renderSidebar(errors, totalWords) {
  lastErrors = errors
  lastTotal  = totalWords

  const visible = errors.filter((e, i) => !ignoredKeys.has(`${e.word}:${i}`))
  const sidebar  = getOrCreateSidebar()
  sidebar.innerHTML = ''

  // ── Header ──
  const header = document.createElement('div')
  header.className = 'uz-docs-header'

  const titleRow = document.createElement('div')
  titleRow.className = 'uz-docs-title-row'

  const title = document.createElement('span')
  title.className = 'uz-docs-title'
  title.innerHTML = "<b>O'z</b>Tekshiruv"
  titleRow.appendChild(title)

  if (visible.length > 0) {
    const badge = document.createElement('span')
    badge.className   = 'uz-docs-badge'
    badge.textContent = visible.length
    titleRow.appendChild(badge)
  }

  const closeBtn = document.createElement('button')
  closeBtn.className   = 'uz-docs-close'
  closeBtn.textContent = '✕'
  closeBtn.title       = 'Yopish'
  closeBtn.onclick     = () => { sidebarEl.remove(); sidebarEl = null }
  titleRow.appendChild(closeBtn)
  header.appendChild(titleRow)

  const stats = document.createElement('div')
  stats.className = 'uz-docs-stats'
  const errClass = visible.length > 0 ? 'uz-docs-stat-err' : ''
  stats.innerHTML = `<span>${totalWords} so'z</span><span class="${errClass}">${visible.length} xato</span>`
  header.appendChild(stats)

  if (visible.length > 0) {
    const acceptAll = document.createElement('button')
    acceptAll.className   = 'uz-docs-accept-all'
    acceptAll.textContent = '✓ Barchasini qabul qilish'
    acceptAll.onclick     = () => applySequential([...visible].reverse(), 0)
    header.appendChild(acceptAll)
  }

  sidebar.appendChild(header)

  // ── Body ──
  const body = document.createElement('div')
  body.className = 'uz-docs-body'

  if (visible.length === 0) {
    const ok = document.createElement('div')
    ok.className   = 'uz-docs-clear'
    ok.textContent = '✓ Xatolar topilmadi'
    body.appendChild(ok)
  } else {
    visible.forEach((err) => {
      const origIdx = errors.indexOf(err)
      const [top, ...rest] = err.suggestions
      if (!top) return

      const card = document.createElement('div')
      card.className = 'uz-docs-card'

      const cat = document.createElement('div')
      cat.className   = 'uz-docs-card-category'
      cat.textContent = getCategory(err.word, top)
      card.appendChild(cat)

      const corrRow = document.createElement('div')
      corrRow.className = 'uz-docs-correction'
      corrRow.innerHTML =
        `<span class="uz-docs-wrong">${err.word}</span>` +
        `<span class="uz-docs-arrow">→</span>` +
        `<span class="uz-docs-right">${top}</span>`
      card.appendChild(corrRow)

      if (rest.length > 0) {
        const alts = document.createElement('div')
        alts.className = 'uz-docs-alts'
        rest.forEach(s => {
          const chip = document.createElement('button')
          chip.className   = 'uz-docs-alt-chip'
          chip.textContent = s
          chip.onclick     = () => applyCorrection(err.word, s)
          alts.appendChild(chip)
        })
        card.appendChild(alts)
      }

      const actions = document.createElement('div')
      actions.className = 'uz-docs-actions'

      const acceptBtn = document.createElement('button')
      acceptBtn.className   = 'uz-docs-btn uz-docs-btn--accept'
      acceptBtn.textContent = '✓ Qabul'
      acceptBtn.onclick     = () => applyCorrection(err.word, top)
      actions.appendChild(acceptBtn)

      const ignoreBtn = document.createElement('button')
      ignoreBtn.className   = 'uz-docs-btn uz-docs-btn--ignore'
      ignoreBtn.textContent = "E'tiborsiz"
      ignoreBtn.onclick     = () => {
        ignoredKeys.add(`${err.word}:${origIdx}`)
        renderSidebar(lastErrors, lastTotal)
      }
      actions.appendChild(ignoreBtn)

      card.appendChild(actions)
      body.appendChild(card)
    })
  }

  sidebar.appendChild(body)
}

// ── Apply correction via Find & Replace ──────────────────────────────────────
function applyCorrection(misspelled, suggestion) {
  const editor = document.querySelector('.kix-appview-editor')
  if (!editor) return
  editor.focus()
  editor.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'h', keyCode: 72, ctrlKey: true, bubbles: true, cancelable: true,
  }))
  setTimeout(() => {
    const inputs = document.querySelectorAll(
      '.docs-findreplacebutton-container input, .modal-dialog input[type="text"]'
    )
    if (inputs.length >= 2) {
      inputs[0].value = misspelled
      inputs[1].value = suggestion
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => {
        document.querySelector('[aria-label="Replace all"], .modal-dialog button:last-of-type')?.click()
        setTimeout(() => {
          document.querySelector('[aria-label="Close"], .modal-dialog .close-button')?.click()
        }, 300)
      }, 200)
    }
  }, 400)
}

function applySequential(list, idx) {
  if (idx >= list.length) return
  applyCorrection(list[idx].word, list[idx].suggestions[0])
  setTimeout(() => applySequential(list, idx + 1), 800)
}

// ── Auto-trigger on page load ─────────────────────────────────────────────────
function tryAutoCheck() {
  if (autoCheckDone) return
  const text = readDocsText()
  if (!text || text.length < 10) return
  autoCheckDone = true
  clearInterval(pollTimer)   // stop polling once we have text
  runCheck(text)
}

// Poll every 300ms until text appears (handles async Docs loader)
pollTimer = setInterval(tryAutoCheck, 300)

// Stop polling after 30s regardless (tab may have no text)
setTimeout(() => clearInterval(pollTimer), 30000)

// MutationObserver as additional trigger
new MutationObserver(() => {
  if (!autoCheckDone) tryAutoCheck()
}).observe(document.body, { childList: true, subtree: true })

// ── Keyup listener (handles edits after initial load) ────────────────────────
document.addEventListener('keyup', () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const text = readDocsText()
    if (!text || text.length < 3) return
    autoCheckDone = true
    clearInterval(pollTimer)
    runCheck(text)
  }, DEBOUNCE_MS)
}, true)

// ── Handle CHECK_NOW from popup "Hozir tekshirish" button ────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CHECK_NOW') {
    autoCheckDone = false
    const text = readDocsText()
    if (text && text.length > 5) {
      autoCheckDone = true
      runCheck(text)
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: false, reason: 'No text found in document' })
    }
  }
  return false
})
