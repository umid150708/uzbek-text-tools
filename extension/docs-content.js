/**
 * docs-content.js  —  Google Docs content script
 *
 * Behaviour
 * ──────────
 * • Sidebar appears IMMEDIATELY when the page loads — never waits for a check.
 * • Initial state: spinner ("Tekshirilmoqda…") while polling for document text.
 * • Once text is found and checked, sidebar fills with error cards.
 * • Close (✕) hides the sidebar and shows a small "OʻZ" tab on the right edge.
 * • Clicking that tab re-opens the sidebar.
 * • "Hozir tekshirish" popup button also forces a fresh check and re-opens.
 */

'use strict'

const DEBOUNCE_MS = 900

// ── State ─────────────────────────────────────────────────────────────────────
let debounceTimer = null
let sidebarEl     = null
let fabEl         = null          // floating re-open tab
let ignoredKeys   = new Set()
let lastErrors    = []
let lastTotal     = 0
let pollTimer     = null
let autoCheckDone = false

// ── Language detection ────────────────────────────────────────────────────────
function isLikelyUzbek(text) {
  if (!text) return false
  if (text.replace(/\s/g, '').length < 15) return true

  if (/[Ѐ-ӿ]/.test(text)) return false           // Cyrillic — skip

  const t = text.toLowerCase()
  // U+0027 | U+2018 | U+2019 (Google Docs default) | U+02BB | U+02BC
  if (/[og]['''ʻʼ]/.test(t)) return true

  const WORDS = /\b(va|bu|bir|biz|siz|ular|men|sen|bor|ham|lekin|ammo|uchun|bilan|keyin|oldin|emas|chunki|hali|endi|nima|kim|qayda|yerda|qanday|qachon|shunday|bunday|agar|faqat|hech|juda|eng)\b/g
  if ((t.match(WORDS) || []).length >= 2) return true

  const words    = (t.match(/\b\w+\b/g) || []).length
  const digraphs = (t.match(/sh|ch|ng/g) || []).length
  if (words >= 5 && digraphs / words > 0.3) return true

  return false
}

// ── Read document text ────────────────────────────────────────────────────────
/**
 * Extracts document text from Google Docs.
 *
 * KEY INSIGHT: Google Docs renders the visible document in plain div elements
 * (NOT in contenteditable).  The contenteditable is a tiny hidden input handler.
 * Class names (.kix-*) change between Docs versions.
 *
 * STRATEGY: Hit-test the centre of the viewport to land on the document page,
 * then walk up the DOM until we reach a layout-level container.  The deepest
 * ancestor that still has > 50 chars of innerText is the page content area.
 * This works regardless of class naming because it follows the visual layout.
 */
function readDocsText() {
  const SKIP = '#uz-docs-sidebar, #uz-docs-fab'
  const vw = window.innerWidth
  const vh = window.innerHeight

  // ── Strategy 1: hit-test the document page ──
  // Try several points across the centre of the viewport (handles scroll gaps
  // between pages, different sidebar widths, etc.)
  const probePoints = [
    [vw * 0.35, vh * 0.45],
    [vw * 0.35, vh * 0.65],
    [vw * 0.45, vh * 0.50],
    [vw * 0.30, vh * 0.35],
  ]

  for (const [x, y] of probePoints) {
    const hit = document.elementFromPoint(x, y)
    if (!hit || hit.closest(SKIP) || hit === document.body) continue
    const text = walkUpForText(hit, SKIP, vw)
    if (text && text.length > 50) return text
  }

  // ── Strategy 2: known Google Docs class selectors (legacy fallback) ──
  const SELECTORS = [
    '.kix-appview-editor', '.kix-page', '.kix-lineview-text-block',
    '[class*="kix-paragraph"]', '.docs-editor-container',
  ]
  for (const sel of SELECTORS) {
    try {
      const els = document.querySelectorAll(sel)
      if (!els.length) continue
      const t = (els.length === 1)
        ? els[0].innerText?.trim()
        : Array.from(els).map(e => e.textContent).join('\n').trim()
      if (t && t.length > 50) return t
    } catch {}
  }

  // ── Strategy 3: ARIA roles ──
  for (const sel of ['[role="main"]', '[role="document"]', '[role="textbox"]']) {
    const el = document.querySelector(sel)
    if (!el || el.closest(SKIP)) continue
    const t = el.innerText?.trim()
    if (t && t.length > 50) return t
  }

  return null
}

/** Walk up from `startEl`, collecting the deepest element whose innerText is
 *  substantial.  Stop when we reach a layout-level container (wider than 80%
 *  of viewport) — past that point, innerText includes toolbar/sidebar junk. */
function walkUpForText(startEl, skip, vw) {
  let el = startEl
  let best = null

  while (el && el !== document.body && el !== document.documentElement) {
    if (el.closest(skip)) { el = el.parentElement; continue }

    const rect = el.getBoundingClientRect()
    const t = el.innerText?.trim()

    if (t && t.length > 50) best = t

    // Once the element is as wide as most of the viewport we've exited
    // the page area and entered a full-width layout container — stop.
    if (rect.width > vw * 0.85 && best) break

    el = el.parentElement
  }
  return best
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
  const norm = s => s.toLowerCase().replace(/['''ʻʼ]/g, "'")
  const w = norm(word), s = norm(suggestion)
  if (w.replace(/'/g, '') === s.replace(/'/g, '')) return 'Apostrof belgisi'
  if (Math.abs(w.length - s.length) > 3) return "To'liqsiz so'z"
  return 'Imlo xatosi'
}

// ── Sidebar open / close / FAB ────────────────────────────────────────────────
function ensureFab() {
  if (fabEl && document.body.contains(fabEl)) return fabEl
  fabEl = document.createElement('button')
  fabEl.id        = 'uz-docs-fab'
  fabEl.innerHTML = "<span>O'z</span>"
  fabEl.title     = "OʻzTekshiruv — ochish"
  fabEl.onclick   = openSidebar
  document.body.appendChild(fabEl)
  return fabEl
}

function openSidebar() {
  if (!sidebarEl || !document.body.contains(sidebarEl)) {
    // Sidebar was removed (e.g. page navigation) — re-create
    sidebarEl = null
    showLoadingSidebar()
  } else {
    sidebarEl.classList.remove('uz-docs-hidden')
  }
  ensureFab().style.display = 'none'
}

function closeSidebar() {
  if (sidebarEl) sidebarEl.classList.add('uz-docs-hidden')
  ensureFab().style.display = 'flex'
}

// ── Sidebar HTML builders ─────────────────────────────────────────────────────
function buildHeader(errorCount, totalWords) {
  const header = document.createElement('div')
  header.className = 'uz-docs-header'

  const titleRow = document.createElement('div')
  titleRow.className = 'uz-docs-title-row'

  const title = document.createElement('span')
  title.className = 'uz-docs-title'
  title.innerHTML = "<b>O'z</b>Tekshiruv"
  titleRow.appendChild(title)

  if (errorCount > 0) {
    const badge = document.createElement('span')
    badge.className   = 'uz-docs-badge'
    badge.textContent = errorCount
    titleRow.appendChild(badge)
  }

  const closeBtn = document.createElement('button')
  closeBtn.className   = 'uz-docs-close'
  closeBtn.textContent = '✕'
  closeBtn.title       = 'Yopish'
  closeBtn.onclick     = closeSidebar
  titleRow.appendChild(closeBtn)
  header.appendChild(titleRow)

  if (totalWords !== null) {
    const stats = document.createElement('div')
    stats.className = 'uz-docs-stats'
    const errClass = errorCount > 0 ? 'uz-docs-stat-err' : ''
    stats.innerHTML = `<span>${totalWords} so'z</span><span class="${errClass}">${errorCount} xato</span>`
    header.appendChild(stats)
  }

  return header
}

function getSidebar() {
  if (!sidebarEl || !document.body.contains(sidebarEl)) {
    sidebarEl = document.createElement('div')
    sidebarEl.id = 'uz-docs-sidebar'
    document.body.appendChild(sidebarEl)
  }
  return sidebarEl
}

function showLoadingSidebar() {
  const sidebar = getSidebar()
  sidebar.classList.remove('uz-docs-hidden')
  sidebar.innerHTML = ''
  sidebar.appendChild(buildHeader(0, null))

  const body = document.createElement('div')
  body.className = 'uz-docs-body'
  body.innerHTML = `<div class="uz-docs-loading"><span class="uz-docs-spinner"></span><span>Tekshirilmoqda…</span></div>`
  sidebar.appendChild(body)

  ensureFab().style.display = 'none'
}

function showNotUzbekSidebar() {
  const sidebar = getSidebar()
  sidebar.classList.remove('uz-docs-hidden')
  sidebar.innerHTML = ''
  sidebar.appendChild(buildHeader(0, null))

  const body = document.createElement('div')
  body.className = 'uz-docs-body'
  body.innerHTML = `<div class="uz-docs-lang-notice">O'zbek matni aniqlanmadi.<br>Lotin yozuvida o'zbek matni kiriting.</div>`
  sidebar.appendChild(body)
}

function renderSidebar(errors, totalWords) {
  lastErrors = errors
  lastTotal  = totalWords

  const visible = errors.filter((e, i) => !ignoredKeys.has(`${e.word}:${i}`))
  const sidebar  = getSidebar()
  sidebar.classList.remove('uz-docs-hidden')
  sidebar.innerHTML = ''

  sidebar.appendChild(buildHeader(visible.length, totalWords))

  const body = document.createElement('div')
  body.className = 'uz-docs-body'

  if (visible.length > 0) {
    const acceptAll = document.createElement('button')
    acceptAll.className   = 'uz-docs-accept-all'
    acceptAll.textContent = '✓ Barchasini qabul qilish'
    acceptAll.onclick     = () => applySequential([...visible].reverse(), 0)
    body.appendChild(acceptAll)
  }

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
  ensureFab().style.display = 'none'
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

// ── Core check ────────────────────────────────────────────────────────────────
async function runCheck(text) {
  if (!text || text.length < 3) return

  if (!isLikelyUzbek(text)) {
    showNotUzbekSidebar()
    return
  }

  showLoadingSidebar()
  try {
    const res = await callBg({ type: 'CHECK_TEXT', text })
    ignoredKeys = new Set()
    renderSidebar(res.errors ?? [], res.total_words ?? 0)
  } catch (err) {
    const body = getSidebar().querySelector('.uz-docs-body')
    if (body) body.innerHTML = `<div class="uz-docs-lang-notice">❌ API xatosi: ${err.message}</div>`
  }
}

// ── Auto-trigger ──────────────────────────────────────────────────────────────
function tryAutoCheck() {
  if (autoCheckDone) return
  const text = readDocsText()
  if (!text || text.length < 10) return
  autoCheckDone = true
  clearInterval(pollTimer)
  runCheck(text)
}

// ── Boot: show sidebar immediately, then find text ────────────────────────────
showLoadingSidebar()           // ← sidebar visible from the very first frame
ensureFab()                    // ← FAB exists but hidden (sidebar is open)

// Poll until document text is available
pollTimer = setInterval(tryAutoCheck, 300)
setTimeout(() => {
  clearInterval(pollTimer)
  if (!autoCheckDone) {
    // 15s passed, still no text — show idle state
    const body = getSidebar().querySelector('.uz-docs-body')
    if (body) body.innerHTML = `<div class="uz-docs-lang-notice">Matn topilmadi.<br>Tekshirmoqchi bo'lsangiz, quyidagi tugmani bosing yoki matn yozing.</div>`
  }
}, 15000)

new MutationObserver(() => { if (!autoCheckDone) tryAutoCheck() })
  .observe(document.body, { childList: true, subtree: true })

// ── Keyup: re-check on edit ───────────────────────────────────────────────────
document.addEventListener('keyup', () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const text = readDocsText()
    if (!text || text.length < 3) return
    autoCheckDone = true
    clearInterval(pollTimer)
    ignoredKeys = new Set()
    runCheck(text)
  }, DEBOUNCE_MS)
}, true)

// ── Popup "Hozir tekshirish" button ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CHECK_NOW') {
    autoCheckDone = false
    openSidebar()
    const text = readDocsText()
    if (text && text.length > 5) {
      autoCheckDone = true
      runCheck(text)
      sendResponse({ ok: true })
    } else {
      showLoadingSidebar()
      // re-start polling
      pollTimer = setInterval(tryAutoCheck, 300)
      sendResponse({ ok: false, reason: 'No text yet, polling started' })
    }
  }
  return false
})
