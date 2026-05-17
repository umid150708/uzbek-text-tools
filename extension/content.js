/**
 * content.js  —  runs on every page except docs.google.com
 *
 * Handles two field types:
 *
 *   contenteditable  — injects <span class="uz-error"> tags directly into the
 *                      DOM, exactly like the web app editor.
 *
 *   <textarea>       — positions a transparent overlay div on top of the
 *                      textarea.  The overlay mirrors the textarea's exact
 *                      font/padding and draws red wavy underlines over error
 *                      words.  The textarea itself is unchanged.
 *
 * Both types show a suggestion dropdown when an underlined word is clicked.
 */

'use strict'

const DEBOUNCE_MS  = 600
const MIN_TEXT_LEN = 3

// ── Per-field state ──────────────────────────────────────────────────────────
// WeakMap so entries are GC'd when the field is removed from the DOM.
const fieldState = new WeakMap()

// ── Dropdown ─────────────────────────────────────────────────────────────────
let activeDropdown = null

function showDropdown(anchorRect, suggestions, onAccept) {
  removeDropdown()

  const el = document.createElement('div')
  el.className = 'uz-dropdown'

  const label = document.createElement('div')
  label.className = 'uz-dropdown-label'
  label.textContent = 'Tavsiyalar'
  el.appendChild(label)

  if (!suggestions.length) {
    const empty = document.createElement('div')
    empty.className = 'uz-dropdown-empty'
    empty.textContent = 'Tavsiya topilmadi'
    el.appendChild(empty)
  } else {
    for (const s of suggestions) {
      const btn = document.createElement('button')
      btn.className = 'uz-dropdown-item'
      btn.textContent = s
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()   // don't blur the field
        onAccept(s)
        removeDropdown()
      })
      el.appendChild(btn)
    }
  }

  // Initial position (below the word)
  el.style.left = `${anchorRect.left + window.scrollX}px`
  el.style.top  = `${anchorRect.bottom + window.scrollY + 4}px`
  document.documentElement.appendChild(el)
  activeDropdown = el

  // Nudge left if off the right edge
  const r = el.getBoundingClientRect()
  if (r.right > window.innerWidth - 8) {
    el.style.left = `${window.scrollX + window.innerWidth - r.width - 8}px`
  }
  // Flip above if off the bottom edge
  if (r.bottom > window.innerHeight - 8) {
    el.style.top = `${anchorRect.top + window.scrollY - r.height - 4}px`
  }
}

function removeDropdown() {
  activeDropdown?.remove()
  activeDropdown = null
}

// Close dropdown on any outside click
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.uz-dropdown')) removeDropdown()
}, true)

// ── Background relay ──────────────────────────────────────────────────────────
function callBg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message))
      if (res?.error) return reject(new Error(res.error))
      resolve(res)
    })
  })
}

// ── HTML builder ──────────────────────────────────────────────────────────────
function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function buildHTML(text, errors) {
  if (!errors?.length) return esc(text)
  const sorted = [...errors].sort((a, b) => a.start - b.start)
  let html = '', pos = 0
  for (const e of sorted) {
    if (e.start < pos || e.end > text.length) continue
    html += esc(text.slice(pos, e.start))
    html += `<span class="uz-error" data-start="${e.start}" data-end="${e.end}" data-sug="${esc(JSON.stringify(e.suggestions))}">${esc(e.word)}</span>`
    pos = e.end
  }
  return html + esc(text.slice(pos))
}

// ── Cursor utils (contenteditable only) ──────────────────────────────────────
function getCaretOffset(el) {
  const sel = window.getSelection()
  if (!sel?.rangeCount || !el.contains(sel.getRangeAt(0).endContainer)) return 0
  const pre = sel.getRangeAt(0).cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset)
  return pre.toString().length
}

function setCaretOffset(el, offset) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let rem = offset, node, placed = false
  while ((node = walker.nextNode())) {
    const len = node.textContent.length
    if (rem <= len) { range.setStart(node, rem); range.collapse(true); placed = true; break }
    rem -= len
  }
  if (!placed) { range.selectNodeContents(el); range.collapse(false) }
  sel.removeAllRanges()
  sel.addRange(range)
}

// ── ContentEditable ───────────────────────────────────────────────────────────
function setupContentEditable(el) {
  if (fieldState.has(el)) return
  const state = { timer: null, errors: [] }
  fieldState.set(el, state)

  el.addEventListener('input', () => {
    clearTimeout(state.timer)
    const text = el.innerText
    if (text.trim().length < MIN_TEXT_LEN) { el.innerHTML = esc(text); state.errors = []; return }
    state.timer = setTimeout(async () => {
      try {
        const res = await callBg({ type: 'CHECK_TEXT', text })
        state.errors = res.errors ?? []
        const offset = getCaretOffset(el)
        el.innerHTML = buildHTML(text, state.errors)
        setCaretOffset(el, offset)
      } catch { /* network unavailable — silent fail */ }
    }, DEBOUNCE_MS)
  })

  el.addEventListener('click', (e) => {
    const span = e.target.closest('.uz-error')
    if (!span) return
    const suggestions = JSON.parse(span.dataset.sug || '[]')
    const start = +span.dataset.start, end = +span.dataset.end
    showDropdown(span.getBoundingClientRect(), suggestions, (sug) => {
      const text  = el.innerText
      const newText = text.slice(0, start) + sug + text.slice(end)
      el.innerText = newText   // clear spans first
      setCaretOffset(el, start + sug.length)
      // Re-check with corrected text
      callBg({ type: 'CHECK_TEXT', text: newText }).then((res) => {
        const offset = getCaretOffset(el)
        el.innerHTML = buildHTML(newText, res.errors ?? [])
        setCaretOffset(el, offset)
      }).catch(() => {})
    })
  })
}

// ── Textarea overlay ──────────────────────────────────────────────────────────
const MIRRORED_STYLES = [
  'fontFamily','fontSize','fontWeight','fontStyle','lineHeight',
  'letterSpacing','wordSpacing','textAlign','textTransform','tabSize',
  'paddingTop','paddingRight','paddingBottom','paddingLeft',
  'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
]

function createOverlay(textarea) {
  const ov = document.createElement('div')
  ov.className = 'uz-textarea-overlay'

  // Copy all font/spacing styles so characters land at the same pixel positions
  const cs = window.getComputedStyle(textarea)
  for (const p of MIRRORED_STYLES) ov.style[p] = cs[p]
  ov.style.whiteSpace    = 'pre-wrap'
  ov.style.wordWrap      = 'break-word'
  ov.style.overflowY     = 'hidden'
  ov.style.pointerEvents = 'none'   // clicks fall through to the real textarea
  ov.style.color         = 'transparent'  // hide duplicate text; underlines stay

  positionOverlay(ov, textarea)
  document.documentElement.appendChild(ov)
  return ov
}

function positionOverlay(ov, textarea) {
  const r = textarea.getBoundingClientRect()
  ov.style.cssText += `
    position:fixed;
    top:${r.top}px; left:${r.left}px;
    width:${r.width}px; height:${r.height}px;
    z-index:2147483640;
    box-sizing:border-box;
  `
}

function setupTextarea(el) {
  if (fieldState.has(el)) return
  const ov = createOverlay(el)
  const state = { timer: null, errors: [], overlay: ov }
  fieldState.set(el, state)

  // Keep overlay synced with textarea scroll
  el.addEventListener('scroll', () => { ov.scrollTop = el.scrollTop }, { passive: true })

  // Keep overlay in position if page layout shifts
  const ro = new ResizeObserver(() => positionOverlay(ov, el))
  ro.observe(el)
  window.addEventListener('scroll', () => positionOverlay(ov, el), { passive: true })

  el.addEventListener('input', () => {
    clearTimeout(state.timer)
    const text = el.value
    ov.innerHTML = ''   // clear old highlights immediately
    if (text.trim().length < MIN_TEXT_LEN) return
    state.timer = setTimeout(async () => {
      try {
        const res = await callBg({ type: 'CHECK_TEXT', text })
        state.errors = res.errors ?? []
        ov.innerHTML = buildHTML(text, state.errors)
        ov.scrollTop = el.scrollTop
      } catch {}
    }, DEBOUNCE_MS)
  })

  el.addEventListener('click', (e) => {
    // Hit-test the overlay: briefly enable pointer-events, call elementFromPoint,
    // then immediately restore pointer-events:none.
    ov.style.pointerEvents = 'all'
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    ov.style.pointerEvents = 'none'
    if (!hit?.classList.contains('uz-error')) return

    const suggestions = JSON.parse(hit.dataset.sug || '[]')
    const start = +hit.dataset.start, end = +hit.dataset.end
    showDropdown(hit.getBoundingClientRect(), suggestions, (sug) => {
      const text    = el.value
      const newText = text.slice(0, start) + sug + text.slice(end)
      el.value = newText
      el.selectionStart = el.selectionEnd = start + sug.length
      // Notify the page (React, Vue, etc. listen for 'input')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      callBg({ type: 'CHECK_TEXT', text: newText }).then((res) => {
        ov.innerHTML = buildHTML(newText, res.errors ?? [])
        ov.scrollTop = el.scrollTop
      }).catch(() => {})
    })
  })
}

// ── Scanner + MutationObserver ────────────────────────────────────────────────
function isUsableContentEditable(el) {
  if (!el.isContentEditable) return false
  if (el.tagName === 'BODY') return false
  if (el.closest('.uz-dropdown, #uz-docs-sidebar')) return false
  // Skip tiny elements (toolbar buttons, etc.)
  const r = el.getBoundingClientRect()
  return r.width > 80 && r.height > 30
}

function scan(root) {
  if (!(root instanceof Element)) return
  if (root.tagName === 'TEXTAREA') setupTextarea(root)
  else if (isUsableContentEditable(root)) setupContentEditable(root)
  for (const el of root.querySelectorAll('textarea')) setupTextarea(el)
  for (const el of root.querySelectorAll('[contenteditable="true"]')) {
    if (isUsableContentEditable(el)) setupContentEditable(el)
  }
}

scan(document.body)

new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) scan(node)
  }
}).observe(document.body, { childList: true, subtree: true })
