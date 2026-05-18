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
let lastExtracted = ''
let pollTimer     = null
let autoCheckDone = false
let isFirstCheck  = true

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
 * Two-pass approach:
 *   1) Run heuristics on the FULL text (for short/medium docs ≤ 80 words)
 *      or on a representative sample (for large docs).
 *   2) Smart catch-all: if text is > 100 Latin chars with no Cyrillic
 *      and no English articles/pronouns, it's almost certainly Uzbek.
 */
function isLikelyUzbek(text) {
  if (!text) return false
  if (text.replace(/\s/g, '').length < 15) return true
  if (/[Ѐ-ӿ]/.test(text)) return false                      // Cyrillic — skip

  const fullLower = text.toLowerCase()

  // Apostrophe phonemes on FULL text — o' and g' are uniquely Uzbek
  if (/[og]['‘’ʻʼʹ`´]/.test(fullLower)) {
    console.log('[OzTekshiruv] detected: apostrophe phoneme (o\' or g\')')
    return true
  }

  // Apostrophe-aware word extraction (keeps o'/g' intact)
  const allWords = text.match(/[a-zA-Z][a-zA-Z'‘’ʻʼʹ`´]*/g) || []
  if (allWords.length === 0) return false

  const n = allWords.length

  // For short/medium texts: check ALL words. For large texts: sample.
  const checkWords = n <= 80 ? allWords
                   : n <= 300 ? buildSample(allWords, 3, 10)
                               : buildSample(allWords, 5, 12)

  const t = checkWords.join(' ').toLowerCase()

  // High-frequency Uzbek function words
  const FUNC = /\b(va|bu|bir|biz|siz|ular|men|sen|bor|ham|lekin|ammo|uchun|bilan|keyin|oldin|emas|chunki|hali|endi|nima|kim|qanday|qachon|shunday|bunday|agar|faqat|hech|juda|eng|edi|dedi|qildi|keldi|bordi|hamma|har|yana|garchi|shuning|boshladi)\b/g
  const funcMatches = t.match(FUNC) || []
  if (funcMatches.length >= 1) {
    console.log('[OzTekshiruv] detected: FUNC words -', funcMatches)
    return true
  }

  // Uzbek agglutinative suffixes — extremely distinctive
  if (/\w{3,}(lardan|larga|larida|larning|larini|larni|ishdi|ardi|imiz|ingiz)\b/.test(t)) {
    console.log('[OzTekshiruv] detected: agglutinative suffix')
    return true
  }

  // High 'q' density — rare in European languages, common in Uzbek Latin
  const sWords  = t.match(/\b[a-z]{2,}\b/g) || []
  const qCount  = sWords.filter(w => w.includes('q')).length
  if (sWords.length >= 4 && qCount / sWords.length > 0.15) {
    console.log('[OzTekshiruv] detected: high q-density')
    return true
  }

  // Uzbek digraph density (sh/ch only — "ng" fires on English "-ing")
  const digraphs = (t.match(/sh|ch/g) || []).length
  if (sWords.length >= 4 && digraphs / sWords.length > 0.15) {
    console.log('[OzTekshiruv] detected: high sh/ch density')
    return true
  }

  // Smart catch-all: Latin text > 100 chars with NO common English words
  // and no Cyrillic is almost certainly Uzbek (in a Google Doc context)
  if (text.length > 100) {
    const EN = /\b(the|is|are|was|were|have|has|had|this|that|with|from|they|their|them|would|could|should|about|which|where|there|these|those|what|when|been|being|will|your|than|some|into|each|also|very|most|not|but|for|you|all|can|her|his|how|its|may|our|own|say|she|too|use|way)\b/gi
    const enHits = (text.match(EN) || []).length
    if (enHits === 0) {
      console.log('[OzTekshiruv] detected: catch-all (long Latin, no English words)')
      return true
    }
  }

  console.log('[OzTekshiruv] NOT detected as Uzbek.', { textLen: text.length, n, firstWords: allWords.slice(0, 10), funcMatches })
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

  console.log('[OzTekshiruv] readDocsText() called, vw:', vw, 'vh:', vh)

  // Helper: strip toolbar/menu text that leaks into textContent extractions
  function cleanDocText(raw) {
    if (!raw) return ''
    // Remove common Google Docs UI text that gets mixed in
    return raw
      .replace(/^(File|Edit|View|Insert|Format|Tools|Extensions|Help|Accessibility)\s*/gm, '')
      .replace(/^(Menus|Main toolbar|Last edit was .*)$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  // Helper: check if text looks like document content (not just toolbar noise)
  function isDocContent(text) {
    if (!text || text.length < 20) return false
    const words = text.match(/[a-zA-Z]{2,}/g) || []
    if (words.length < 3) return false
    // If >80% of words are common English UI words, it's toolbar text
    const UI_WORDS = /^(file|edit|view|insert|format|tools|extensions|help|undo|redo|print|share|new|open|save|cut|copy|paste|zoom|find|replace|menu|toolbar|accessibility|normal|text|heading|font|bold|italic|underline|align|left|right|center|table|image|link|comment|numbered|bulleted|list|paragraph|spacing|columns|page|break|margins|headers|footers)$/i
    const uiCount = words.filter(w => UI_WORDS.test(w)).length
    return uiCount / words.length < 0.5
  }

  // ── Strategy 0: page-context script with multiple extraction methods ──
  // Injected script runs in PAGE world where Google Docs' JS model lives.
  try {
    const id = 'uz-extracted-' + Date.now()
    const script = document.createElement('script')
    script.textContent = `(function(){
      try {
        var results = {};
        // Method A: aria-label attributes in editor area (accessibility text)
        var ariaEls = document.querySelectorAll('.kix-appview-editor [aria-label]');
        if (ariaEls.length) {
          var labels = [];
          for (var i = 0; i < ariaEls.length; i++) {
            var lbl = ariaEls[i].getAttribute('aria-label');
            if (lbl && lbl.length > 1) labels.push(lbl);
          }
          if (labels.length) results.ariaLabels = labels.join(' ');
        }

        // Method B: textContent on kix-page elements (hidden accessibility spans)
        var pages = document.querySelectorAll('.kix-page, .kix-page-content-wrapper, [data-page-index]');
        if (pages.length) {
          var pt = '';
          for (var i = 0; i < pages.length; i++) pt += ' ' + (pages[i].textContent || '');
          results.pageText = pt.trim();
        }

        // Method C: innerText from editor selectors (works in non-canvas mode)
        var sels = ['.kix-appview-editor', '.kix-page', '[role="textbox"]', '[role="main"]'];
        for (var i = 0; i < sels.length; i++) {
          var el = document.querySelector(sels[i]);
          if (el) {
            var s = (el.innerText || '').trim();
            if (s.length > 20) { results.innerText = s; break; }
          }
        }

        // Method D: TreeWalker for text nodes inside editor
        var editor = document.querySelector('.kix-appview-editor') ||
                     document.querySelector('[role="main"]');
        if (editor) {
          var walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
          var parts = [], seen = {};
          var node;
          while ((node = walker.nextNode())) {
            var t = (node.textContent || '').trim();
            if (t.length > 1 && !seen[t]) { seen[t] = 1; parts.push(t); }
          }
          if (parts.length) results.treeWalker = parts.join(' ');
        }

        // Method E: body textContent as last resort
        results.bodyText = (document.body.textContent || '').trim().substring(0, 5000);

        // Pick the best result: prefer aria labels, then page text, then innerText
        var best = '';
        var source = 'none';
        var candidates = [
          ['ariaLabels', results.ariaLabels],
          ['pageText', results.pageText],
          ['treeWalker', results.treeWalker],
          ['innerText', results.innerText],
          ['bodyText', results.bodyText]
        ];
        for (var i = 0; i < candidates.length; i++) {
          var val = (candidates[i][1] || '').trim();
          if (val.length > best.length) { best = val; source = candidates[i][0]; }
        }

        // Store diagnostic info
        var diag = {};
        for (var k in results) diag[k] = (results[k] || '').length;
        diag.source = source;
        diag.preview = best.substring(0, 200);
        document.documentElement.setAttribute('${id}', JSON.stringify({text: best.substring(0, 10000), diag: diag}));
      } catch(e) {
        document.documentElement.setAttribute('${id}', JSON.stringify({text:'', diag:{error: e.message}}));
      }
    })()`;
    document.documentElement.appendChild(script)
    script.remove()
    const raw = document.documentElement.getAttribute(id) || '{}'
    document.documentElement.removeAttribute(id)
    try {
      const parsed = JSON.parse(raw)
      const text = cleanDocText(parsed.text || '')
      console.log('[OzTekshiruv] Strategy 0 diag:', JSON.stringify(parsed.diag))
      console.log('[OzTekshiruv] Strategy 0 cleaned text:', text.length, 'chars:', JSON.stringify(text.substring(0, 150)))
      if (text && text.length > 20 && isDocContent(text)) {
        console.log('[OzTekshiruv] Strategy 0 SUCCESS via', parsed.diag?.source)
        return text
      }
    } catch {}
  } catch (e) { console.log('[OzTekshiruv] Strategy 0 error:', e.message) }

  // ── Strategy 1: aria-label scan in content script world ──
  try {
    const ariaEls = document.querySelectorAll('[aria-label]')
    const labels = []
    for (const el of ariaEls) {
      if (el.closest(SKIP)) continue
      // Skip toolbar/menu aria-labels (usually short, single-word)
      const lbl = el.getAttribute('aria-label')
      if (lbl && lbl.length > 3 && !/^(Bold|Italic|Underline|Strikethrough|Font|Size|Color|Align|Indent|Line|More|Undo|Redo|Print|Paint|Insert|Normal|Heading|Title|Subtitle|Menu|Close|Open|Format|Text|Zoom|Share|Comments?|Reply|Spelling|Accept|Reject|Find|Replace|All)$/i.test(lbl)) {
        labels.push(lbl)
      }
    }
    if (labels.length > 0) {
      const text = cleanDocText(labels.join(' '))
      if (text.length > 20 && isDocContent(text)) {
        console.log('[OzTekshiruv] Strategy 1 (aria-labels) →', text.length, 'chars from', labels.length, 'labels')
        return text
      }
    }
  } catch {}
  console.log('[OzTekshiruv] Strategy 1 (aria-labels) failed')

  // ── Strategy 2: hit-test the document page ──
  const probePoints = [
    [vw * 0.35, vh * 0.45],
    [vw * 0.35, vh * 0.65],
    [vw * 0.45, vh * 0.50],
    [vw * 0.30, vh * 0.35],
    [vw * 0.25, vh * 0.55],
  ]

  for (const [x, y] of probePoints) {
    const hit = document.elementFromPoint(x, y)
    if (!hit || hit.closest(SKIP) || hit === document.body) continue
    const text = walkUpForText(hit, SKIP, vw)
    if (text && text.length > 50) {
      console.log('[OzTekshiruv] Strategy 2 hit at', Math.round(x), Math.round(y), '→', text.length, 'chars')
      return text
    }
  }
  console.log('[OzTekshiruv] Strategy 2 (hit-test) failed')

  // ── Strategy 3: textContent on page containers ──
  const TC_SELECTORS = [
    '.kix-page-content-wrapper',
    '.kix-page',
    '[data-page-index]',
    '.kix-appview-editor',
  ]
  for (const sel of TC_SELECTORS) {
    try {
      const els = document.querySelectorAll(sel)
      if (!els.length) continue
      let combined = ''
      for (const el of els) {
        if (el.closest(SKIP)) continue
        const t = el.textContent?.trim()
        if (t) combined += (combined ? '\n' : '') + t
      }
      const cleaned = cleanDocText(combined)
      if (cleaned.length > 30 && isDocContent(cleaned)) {
        console.log('[OzTekshiruv] Strategy 3 textContent (' + sel + ') →', cleaned.length, 'chars')
        return cleaned
      }
    } catch {}
  }
  console.log('[OzTekshiruv] Strategy 3 (textContent containers) failed')

  // ── Strategy 4: TreeWalker collecting all text nodes ──
  try {
    const editor = document.querySelector('.kix-appview-editor') ||
                   document.querySelector('[role="main"]') ||
                   document.querySelector('.docs-editor-container')
    const root = editor || document.body
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const parts = []
    const seen  = new Set()
    let node
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest(SKIP)) continue
      const t = node.textContent?.trim()
      if (t && t.length > 1 && !seen.has(t)) {
        seen.add(t)
        parts.push(t)
      }
    }
    if (parts.length > 0) {
      const combined = cleanDocText(parts.join(' '))
      if (combined.length > 30 && isDocContent(combined)) {
        console.log('[OzTekshiruv] Strategy 4 TreeWalker →', combined.length, 'chars from', parts.length, 'nodes')
        return combined
      }
    }
  } catch {}
  console.log('[OzTekshiruv] Strategy 4 (TreeWalker) failed')

  // ── Strategy 5: brute-force — body textContent with aggressive cleaning ──
  try {
    const raw = document.body.textContent?.trim()
    if (raw && raw.length > 50) {
      const cleaned = cleanDocText(raw)
      console.log('[OzTekshiruv] Strategy 5 (body textContent) →', cleaned.length, 'chars')
      if (cleaned.length > 20) return cleaned
    }
  } catch {}

  console.log('[OzTekshiruv] ALL strategies failed — no text found')
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
      const t = (el.innerText?.trim()) || (el.textContent?.trim())
      if (t && (!best || t.length > best.length)) best = t
    }

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
  title.innerHTML = "<b>O'z</b>Tekshiruv <small style='color:#999;font-size:9px'>v2.4</small>"
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
    ok.textContent = totalWords > 0 ? '✓ Xatolar topilmadi' : 'Matn olinmadi — sahifani yangilang'
    body.appendChild(ok)

    if (totalWords === 0) {
      const diag = document.createElement('div')
      diag.style.cssText = 'margin-top:12px;padding:8px;background:#fff3cd;border-radius:6px;font-size:11px;color:#856404;word-break:break-all;max-height:120px;overflow-y:auto'
      diag.textContent = lastExtracted
        ? 'Olingan matn (' + lastExtracted.length + ' belgi): ' + lastExtracted.substring(0, 300)
        : 'Matn olib bo\'lmadi — Google Docs canvas rejimida'
      body.appendChild(diag)
    }
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
  lastExtracted = text

  console.log('[OzTekshiruv] runCheck:', text.length, 'chars, firstCheck:', isFirstCheck)
  console.log('[OzTekshiruv] text preview:', JSON.stringify(text.substring(0, 200)))

  // First check: ALWAYS run the spell checker — skip language detection entirely.
  // This guarantees detection works on page load. Subsequent re-checks (from typing)
  // still use isLikelyUzbek to avoid unnecessary API calls.
  if (!isFirstCheck && !isLikelyUzbek(text)) {
    showNotUzbekSidebar(text)
    return
  }
  isFirstCheck = false

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
  if (!text || text.length < 15) return
  console.log('[OzTekshiruv] tryAutoCheck: got', text.length, 'chars, running check')
  autoCheckDone = true
  clearInterval(pollTimer)
  runCheck(text)
}

// ── Boot: show sidebar immediately, then find text ────────────────────────────
console.log('[OzTekshiruv] docs-content.js v2.4 loaded')
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
