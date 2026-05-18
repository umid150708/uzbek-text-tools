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

/**
 * Pick up to `count` words from `arr` using a random stride.
 * Random start offset gives variety across calls; stride keeps coverage even.
 */
function sampleSection(arr, count) {
  if (arr.length <= count) return arr.slice()
  const stride  = Math.floor(arr.length / count)
  const offset  = Math.floor(Math.random() * stride)
  const result  = []
  for (let i = offset; result.length < count && i < arr.length; i += stride) {
    result.push(arr[i])
  }
  return result
}

/**
 * Divide `words` into `sections` equal slices and pick `perSection` random
 * words from each, returning one representative sample array.
 */
function buildSample(words, sections, perSection) {
  const result      = []
  const sectionSize = Math.ceil(words.length / sections)
  for (let s = 0; s < sections; s++) {
    const start = s * sectionSize
    const end   = Math.min(start + sectionSize, words.length)
    result.push(...sampleSection(words.slice(start, end), perSection))
  }
  return result
}

/**
 * Returns true when the text is likely Latin-script Uzbek.
 *
 * Sampling strategy (avoids scanning huge documents character-by-character):
 *   ≤ 40 words  → use all words
 *   41–300 words → 3 sections × 10 words = 30-word sample
 *   > 300 words  → 5 sections × 12 words = 60-word sample
 *
 * Detection runs on the sample, not the raw text.
 */
function isLikelyUzbek(text) {
  if (!text) return false
  if (text.replace(/\s/g, '').length < 15) return true
  if (/[Ѐ-ӿ]/.test(text)) return false                      // Cyrillic — skip

  // Apostrophe-aware word extraction (keeps o'/g' intact)
  const allWords = text.match(/[a-zA-Z][a-zA-Z'''ʻʼʹ`´]*/g) || []
  if (allWords.length === 0) return false

  const n      = allWords.length
  const sample = n <= 40  ? allWords
               : n <= 300 ? buildSample(allWords, 3, 10)   // medium text
                           : buildSample(allWords, 5, 12)   // large text

  const t = sample.join(' ').toLowerCase()

  // ── Checks on the sample ──────────────────────────────────────────────────

  // U+0027 ' | U+2018 ' | U+2019 ' | U+02BB ʻ | U+02BC ʼ | U+02B9 ʹ | ` | ´
  if (/[og]['''ʻʼʹ`´]/.test(t)) return true

  // High-frequency Uzbek function words (includes "edi" — very common past copula)
  const FUNC = /\b(va|bu|bir|biz|siz|ular|men|sen|bor|ham|lekin|ammo|uchun|bilan|keyin|oldin|emas|chunki|hali|endi|nima|kim|qanday|qachon|shunday|bunday|agar|faqat|hech|juda|eng|edi|dedi|qildi|keldi|bordi|hamma|har|yana|garchi|shuning|boshladi|bo'ldi)\b/g
  const hits = (t.match(FUNC) || []).length
  if (hits >= 2) return true
  if (hits >= 1 && n >= 3) return true   // even 1 Uzbek function word in 3+ word text → Uzbek

  // Uzbek agglutinative suffixes — extremely distinctive
  if (/\w{3,}(lardan|larga|larida|larning|larini|larni|ishdi|ardi|imiz|ingiz)\b/.test(t)) return true

  // High 'q' density — rare in European languages, common in Uzbek Latin
  const sWords  = t.match(/\b[a-z]{2,}\b/g) || []
  const qCount  = sWords.filter(w => w.includes('q')).length
  if (sWords.length >= 4 && qCount / sWords.length > 0.10) return true

  // Uzbek digraph density (sh/ch only — "ng" is too common in English "-ing" endings)
  const digraphs = (t.match(/sh|ch/g) || []).length
  if (sWords.length >= 4 && digraphs / sWords.length > 0.15) return true

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
    if (text && text.length > 100) return text
  }

  // ── Strategy 2: kix-* innerText scan ──
  // innerText (not textContent) so CSS-hidden accessibility nodes are skipped.
  // textContent was causing English words from hidden DOM nodes to leak through.
  try {
    const kixEls = document.querySelectorAll('[class*="kix-"]')
    if (kixEls.length) {
      let best = ''
      for (const el of kixEls) {
        if (el.closest(SKIP)) continue
        const t = el.innerText?.trim()
        if (t && t.length > best.length) best = t
      }
      if (best.length > 50) return best
    }
  } catch {}

  // ── Strategy 3: known Google Docs class selectors ──
  const SELECTORS = [
    '.kix-appview-editor', '.kix-page', '.kix-lineview-text-block',
    '[class*="kix-paragraph"]', '.docs-editor-container', '.docs-editor',
  ]
  for (const sel of SELECTORS) {
    try {
      const els = document.querySelectorAll(sel)
      if (!els.length) continue
      const t = Array.from(els).map(e => e.innerText?.trim()).filter(Boolean).join('\n').trim()
      if (t && t.length > 50) return t
    } catch {}
  }

  // ── Strategy 4: ARIA roles ──
  for (const sel of ['[role="main"]', '[role="document"]', '[role="region"]']) {
    const el = document.querySelector(sel)
    if (!el || el.closest(SKIP)) continue
    const t = el.innerText?.trim()
    if (t && t.length > 50) return t
  }

  // ── Strategy 5: vertical column scan ──
  // Accumulates innerText fragments from many y-positions. innerText only —
  // no textContent fallback so hidden nodes never pollute the result.
  try {
    const seen  = new Set()
    const parts = []
    const midX  = vw * 0.40
    for (let y = vh * 0.12; y < vh * 0.92; y += vh * 0.055) {
      const hit = document.elementFromPoint(midX, y)
      if (!hit || hit.closest(SKIP) || hit === document.body) continue
      let el = hit
      while (el && el !== document.body) {
        const rect = el.getBoundingClientRect()
        if (rect.width > vw * 0.85) break
        const t = el.innerText?.trim()
        if (t && t.length > 3 && !seen.has(t)) { seen.add(t); parts.push(t); break }
        el = el.parentElement
      }
    }
    if (parts.length > 0) {
      const combined = parts.join(' ')
      if (combined.length > 50) return combined
    }
  } catch {}

  return null
}

/**
 * Walk up from `startEl` collecting text. Keeps the LARGEST text block found
 * from elements that are narrower than 92% of the viewport. Stops once a
 * near-full-width container is reached (those include toolbar / menu junk).
 * Falls back to textContent when innerText is empty (CSS-hidden accessibility
 * nodes used by some Google Docs rendering modes).
 */
function walkUpForText(startEl, skip, vw) {
  let el = startEl
  let best = null

  while (el && el !== document.body && el !== document.documentElement) {
    if (el.closest(skip)) { el = el.parentElement; continue }

    const rect = el.getBoundingClientRect()

    if (rect.width <= vw * 0.92) {
      // innerText only — textContent leaks hidden accessibility/UI node text
      const t = el.innerText?.trim()
      if (t && (!best || t.length > best.length)) best = t
    }

    // Stop when we hit a nearly-full-width container AND already have text
    if (rect.width > vw * 0.92 && best && best.length > 100) break

    el = el.parentElement
  }
  return best && best.length > 50 ? best : null
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

function showNotUzbekSidebar(rawText) {
  const sidebar = getSidebar()
  sidebar.classList.remove('uz-docs-hidden')
  sidebar.innerHTML = ''
  sidebar.appendChild(buildHeader(0, null))

  const body = document.createElement('div')
  body.className = 'uz-docs-body'

  const notice = document.createElement('div')
  notice.className = 'uz-docs-lang-notice'
  notice.innerHTML = "O'zbek matni aniqlanmadi.<br>Lotin yozuvida o'zbek matni kiriting."
  body.appendChild(notice)

  // Force-check button so the user can bypass language detection
  if (rawText) {
    const btn = document.createElement('button')
    btn.className   = 'uz-docs-accept-all'
    btn.textContent = 'Baribir tekshirish'
    btn.style.marginTop = '12px'
    btn.onclick = () => {
      showLoadingSidebar()
      callBg({ type: 'CHECK_TEXT', text: rawText })
        .then(res => { ignoredKeys = new Set(); renderSidebar(res.errors ?? [], res.total_words ?? 0) })
        .catch(err => {
          const b = getSidebar().querySelector('.uz-docs-body')
          if (b) b.innerHTML = `<div class="uz-docs-lang-notice">❌ API xatosi: ${err.message}</div>`
        })
    }
    body.appendChild(btn)
  }

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
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)

function applyCorrection(misspelled, suggestion) {
  // Focus the document area — try several selectors
  const editor =
    document.querySelector('[role="textbox"]') ||
    document.querySelector('.kix-appview-editor') ||
    document.querySelector('[contenteditable="true"]')
  if (!editor) return
  editor.focus()

  // Open Find & Replace: Ctrl+H (Windows/Linux) or Cmd+Shift+H (Mac in Docs)
  const kbOpts = IS_MAC
    ? { key: 'h', code: 'KeyH', keyCode: 72, metaKey: true, shiftKey: true, bubbles: true, cancelable: true }
    : { key: 'h', code: 'KeyH', keyCode: 72, ctrlKey: true, bubbles: true, cancelable: true }
  editor.dispatchEvent(new KeyboardEvent('keydown', kbOpts))

  setTimeout(() => {
    // Find the search + replace input fields inside the dialog
    const inputs = document.querySelectorAll(
      '.docs-findinput-input input, ' +
      '.docs-replaceinput-input input, ' +
      '.docs-findreplacebutton-container input, ' +
      '.modal-dialog input[type="text"]'
    )
    if (inputs.length >= 2) {
      setNativeValue(inputs[0], misspelled)
      setNativeValue(inputs[1], suggestion)
      setTimeout(() => {
        // Click "Replace all"
        const replaceAll =
          document.querySelector('[aria-label="Replace all"]') ||
          document.querySelector('[data-tooltip="Replace all"]') ||
          document.querySelector('.docs-findreplacebutton-replaceall')
        replaceAll?.click()
        setTimeout(() => {
          // Close the dialog
          const closeBtn =
            document.querySelector('[aria-label="Close"]') ||
            document.querySelector('.docs-findinput-close') ||
            document.querySelector('.modal-dialog .close-button')
          closeBtn?.click()
          // Re-check text after correction
          setTimeout(() => {
            const text = readDocsText()
            if (text) runCheck(text)
          }, 500)
        }, 300)
      }, 200)
    }
  }, 500)
}

/** Set value on a Google Docs input — native setter triggers their React-like bindings */
function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function applySequential(list, idx) {
  if (idx >= list.length) {
    // All corrections applied — re-check after a pause
    setTimeout(() => {
      const text = readDocsText()
      if (text) runCheck(text)
    }, 600)
    return
  }
  applyCorrection(list[idx].word, list[idx].suggestions[0])
  setTimeout(() => applySequential(list, idx + 1), 1200)
}

// ── Core check ────────────────────────────────────────────────────────────────
async function runCheck(text) {
  if (!text || text.length < 3) return

  // Log the first 200 chars so you can inspect in DevTools → Console
  console.log('[OzTekshiruv] extracted text:', JSON.stringify(text.substring(0, 200)))

  if (!isLikelyUzbek(text)) {
    showNotUzbekSidebar(text)
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
  if (!text || text.length < 40) return
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
