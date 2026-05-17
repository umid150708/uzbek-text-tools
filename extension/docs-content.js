/**
 * docs-content.js  —  Google Docs content script
 *
 * Changes vs v1:
 *  • Auto-trigger on page load: watches for .kix-lineview-text-block nodes
 *    to appear (Docs renders asynchronously) and fires the first check
 *    automatically — no need to type anything.
 *  • Language detection: isLikelyUzbek() gates every API call so English,
 *    Russian, or other-language documents are silently ignored.
 *  • Refactored into a single runCheck() helper used by both the auto-
 *    trigger and the keyup listener.
 */

'use strict'

const DEBOUNCE_MS = 900

// ── State ─────────────────────────────────────────────────────────────────────
let debounceTimer  = null
let sidebarEl      = null
let ignoredKeys    = new Set()
let lastErrors     = []
let lastTotal      = 0
let autoCheckDone  = false   // prevent firing multiple auto-checks on load

// ── Language detection ────────────────────────────────────────────────────────
/**
 * Returns true when the text is likely Latin-script Uzbek.
 *
 * Detection strategy (score-based):
 *  1. o' / g'  — near-definitive Uzbek Latin markers  (→ instant true)
 *  2. High-frequency Uzbek function words              (2+ → true)
 *  3. Uzbek digraph density (sh / ch / ng)             (high ratio → true)
 *
 * Hard exclusions:
 *  • Cyrillic script   — our spell-checker is Latin-only
 *  • Very short text   — too little signal, try anyway
 */
function isLikelyUzbek(text) {
  if (!text) return false
  const bare = text.replace(/\s/g, '')
  if (bare.length < 15) return true            // too short to tell — try anyway

  // Cyrillic → Latin checker won't help
  if (/[Ѐ-ӿ]/.test(text)) return false

  const t = text.toLowerCase()

  // o' / g' are almost exclusive to Uzbek Latin orthography
  if (/[og][''ʻʼ]/.test(t)) return true

  // High-frequency Uzbek function words
  const UZBEK_WORDS = /\b(va|bu|bir|biz|siz|ular|men|sen|bor|ham|lekin|ammo|uchun|bilan|keyin|oldin|emas|chunki|hali|endi|nima|kim|qayda|yerda|qanday|qachon|shunday|bunday)\b/g
  if ((t.match(UZBEK_WORDS) || []).length >= 2) return true

  // High density of Uzbek-typical digraphs relative to word count
  const wordCount     = (t.match(/\b\w+\b/g) || []).length
  const digraphCount  = (t.match(/sh|ch|ng/g) || []).length
  if (wordCount >= 5 && digraphCount / wordCount > 0.35) return true

  return false
}

// ── Read document text ────────────────────────────────────────────────────────
function readDocsText() {
  const blocks = document.querySelectorAll('.kix-lineview-text-block')
  if (blocks.length)
    return Array.from(blocks).map(b => b.textContent).join('\n').trim()
  try {
    const iframe = document.querySelector('.docs-texteventtarget-iframe')
    return iframe?.contentDocument?.body?.innerText?.trim() ?? null
  } catch { return null }
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
  const norm = s => s.toLowerCase().replace(/[''ʻʼ]/g, "'")
  const w = norm(word), s = norm(suggestion)
  if (w.replace(/'/g, '') === s.replace(/'/g, '')) return 'Apostrof belgisi'
  if (Math.abs(w.length - s.length) > 3) return "To'liqsiz so'z"
  return 'Imlo xatosi'
}

// ── Core check function ───────────────────────────────────────────────────────
async function runCheck(text) {
  if (!text || text.length < 3) return

  if (!isLikelyUzbek(text)) {
    // If the sidebar is visible, tell the user why we're not checking
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

  // Show loading state in sidebar
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
  sidebar.querySelector('.uz-docs-close').onclick = () => { sidebarEl.remove(); sidebarEl = null }
}

function showErrorSidebar(msg) {
  const sidebar = getOrCreateSidebar()
  const body = sidebar.querySelector('.uz-docs-body')
  if (body) {
    body.innerHTML = `<div class="uz-docs-lang-notice">❌ API bilan ulanishda xato: ${msg}</div>`
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
    visible.forEach((err, visIdx) => {
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
/**
 * Google Docs loads text asynchronously — .kix-lineview-text-block nodes
 * may not exist when the content script first runs.
 *
 * Strategy:
 *  1. MutationObserver fires the first check as soon as text blocks appear.
 *  2. Fallback timeouts (2 s, 5 s) catch edge cases where the observer
 *     callback fires before enough blocks have been added.
 */
function tryAutoCheck() {
  if (autoCheckDone) return
  const text = readDocsText()
  if (!text || text.length < 10) return   // not enough text yet
  autoCheckDone = true
  runCheck(text)
}

// Watch for Docs text blocks being added to the DOM
const docsObserver = new MutationObserver(() => {
  if (!autoCheckDone) tryAutoCheck()
})
docsObserver.observe(document.body, { childList: true, subtree: true })

// Fallback: try after 2 s and 5 s even if observer didn't help
setTimeout(tryAutoCheck, 2000)
setTimeout(tryAutoCheck, 5000)

// ── Keyup listener (handles subsequent edits) ─────────────────────────────────
document.addEventListener('keyup', () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const text = readDocsText()
    if (!text || text.length < 3) return
    autoCheckDone = true   // mark done so observer stops trying
    runCheck(text)
  }, DEBOUNCE_MS)
}, true)   // capture phase — Docs stops propagation early
