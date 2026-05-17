const DEFAULT_API = 'https://uzbek-text-tools-2.onrender.com'

const urlInput    = document.getElementById('api-url')
const saveBtn     = document.getElementById('save-btn')
const saveMsg     = document.getElementById('save-msg')
const badge       = document.getElementById('status-badge')
const checkNowBtn = document.getElementById('check-now-btn')
const checkMsg    = document.getElementById('check-msg')

// ── Load saved API URL + detect if we're on a Docs tab ────────────────────────
chrome.storage.sync.get(['apiBase'], ({ apiBase }) => {
  urlInput.value = apiBase || DEFAULT_API
  checkApiHealth(urlInput.value)
})

// Show "Check now" button only when the active tab is Google Docs
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab?.url?.includes('docs.google.com')) {
    checkNowBtn.style.display = 'block'
  }
})

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  const val = urlInput.value.trim()
  if (!val) return
  chrome.storage.sync.set({ apiBase: val }, () => {
    showMsg(saveMsg, 'Saqlandi ✓', true)
    checkApiHealth(val)
  })
})

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click()
})

// ── Check Now — sends CHECK_NOW to the active Docs tab ────────────────────────
checkNowBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return
    chrome.tabs.sendMessage(tab.id, { type: 'CHECK_NOW' }, (res) => {
      if (chrome.runtime.lastError) {
        showMsg(checkMsg, '❌ Content script topilmadi. Sahifani yangilang (F5).', false)
        return
      }
      showMsg(checkMsg, '✓ Tekshiruv boshlandi', true)
      setTimeout(() => window.close(), 800)
    })
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function showMsg(el, text, ok) {
  el.textContent = text
  el.className   = 'save-msg ' + (ok ? 'save-msg--ok' : 'save-msg--err')
  setTimeout(() => { el.textContent = '' }, 2500)
}

async function checkApiHealth(base) {
  setBadge('checking')
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/healthz`, {
      signal: AbortSignal.timeout(4000),
    })
    setBadge(res.ok ? 'ok' : 'error')
  } catch {
    setBadge('error')
  }
}

function setBadge(state) {
  badge.className = 'badge'
  if (state === 'ok') {
    badge.textContent = 'Ulangan ✓'
    badge.classList.add('badge--ok')
  } else if (state === 'error') {
    badge.textContent = 'Ulanmadi ✗'
    badge.classList.add('badge--error')
  } else {
    badge.textContent = 'Tekshirilmoqda…'
    badge.classList.add('badge--checking')
  }
}
