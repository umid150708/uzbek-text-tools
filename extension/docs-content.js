/**
 * docs-content.js  —  Google Docs specific content script  (Approach A)
 *
 * Google Docs renders text on a canvas-based engine, so normal contenteditable
 * injection doesn't work.  Strategy:
 *
 *   READ  — pull text from .kix-lineview-text-block accessibility nodes
 *   SHOW  — QuillBot-style sidebar panel (fixed right side)
 *   APPLY — Ctrl+H Find & Replace per correction
 */

'use strict'

const DEBOUNCE_MS = 900

let debounceTimer = null
let sidebarEl     = null
let ignoredKeys   = new Set()   // "word:index" keys dismissed by the user
let lastErrors    = []
let lastTotal     = 0

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

// ── Category helper ───────────────────────────────────────────────────────────
function getCategory(word, suggestion) {
  const norm = s => s.toLowerCase().replace(/[''ʻʼ]/g, "'")
  const w = norm(word), s = norm(suggestion)
  if (w.replace(/'/g, '') === s.replace(/'/g, '')) return 'Apostrof belgisi'
  if (Math.abs(w.length - s.length) > 3) return "To'liqsiz so'z"
  return 'Imlo xatosi'
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function getOrCreateSidebar() {
  if (sidebarEl && document.body.contains(sidebarEl)) return sidebarEl
  sidebarEl = document.createElement('div')
  sidebarEl.id = 'uz-docs-sidebar'
  document.body.appendChild(sidebarEl)
  return sidebarEl
}

function renderSidebar(errors, totalWords) {
  lastErrors = errors
  lastTotal  = totalWords

  const visible = errors.filter((_, i) => !ignoredKeys.has(`${errors[i].word}:${i}`))

  const sidebar = getOrCreateSidebar()
  sidebar.innerHTML = ''

  // ── Header ──
  const header = document.createElement('div')
  header.className = 'uz-docs-header'

  const titleRow = document.createElement('div')
  titleRow.className = 'uz-docs-title-row'

  const title = document.createElement('span')
  title.className = 'uz-docs-title'
  title.innerHTML = '<b>O\'z</b>Tekshiruv'
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
  stats.innerHTML = `<span>${totalWords} so'z</span><span class="${visible.length > 0 ? 'uz-docs-stat-err' : ''}">${visible.length} xato</span>`
  header.appendChild(stats)

  if (visible.length > 0) {
    const acceptAll = document.createElement('button')
    acceptAll.className   = 'uz-docs-accept-all'
    acceptAll.textContent = '✓ Barchasini qabul qilish'
    acceptAll.onclick     = () => {
      // Apply corrections back-to-front via Find & Replace sequentially
      const toFix = [...visible].reverse()
      applySequential(toFix, 0)
    }
    header.appendChild(acceptAll)
  }

  sidebar.appendChild(header)

  // ── Body ──
  const body = document.createElement('div')
  body.className = 'uz-docs-body'

  if (visible.length === 0) {
    const ok = document.createElement('div')
    ok.className   = 'uz-docs-clear'
    ok.textContent = `✓ Xatolar topilmadi`
    body.appendChild(ok)
  } else {
    visible.forEach((err, visIdx) => {
      const origIdx = errors.indexOf(err)
      const [top, ...rest] = err.suggestions
      if (!top) return

      const card = document.createElement('div')
      card.className = 'uz-docs-card'

      // Category
      const cat = document.createElement('div')
      cat.className   = 'uz-docs-card-category'
      cat.textContent = getCategory(err.word, top)
      card.appendChild(cat)

      // Correction row: word → suggestion
      const corrRow = document.createElement('div')
      corrRow.className = 'uz-docs-correction'
      corrRow.innerHTML =
        `<span class="uz-docs-wrong">${err.word}</span>` +
        `<span class="uz-docs-arrow">→</span>` +
        `<span class="uz-docs-right">${top}</span>`
      card.appendChild(corrRow)

      // Alt chips
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

      // Action buttons
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
        const btn = document.querySelector('[aria-label="Replace all"], .modal-dialog button:last-of-type')
        btn?.click()
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

// ── Watch for keystrokes ──────────────────────────────────────────────────────
document.addEventListener('keyup', () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    const text = readDocsText()
    if (!text || text.length < 3) return
    ignoredKeys = new Set()   // fresh check → reset ignores
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
}, true)
