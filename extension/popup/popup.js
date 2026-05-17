const DEFAULT_API = 'https://uzbek-text-tools-2.onrender.com'

const urlInput  = document.getElementById('api-url')
const saveBtn   = document.getElementById('save-btn')
const saveMsg   = document.getElementById('save-msg')
const badge     = document.getElementById('status-badge')

// ── Load saved API URL ────────────────────────────────────────────────────────
chrome.storage.sync.get(['apiBase'], ({ apiBase }) => {
  urlInput.value = apiBase || DEFAULT_API
  checkApiHealth(urlInput.value)
})

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  const val = urlInput.value.trim()
  if (!val) return
  chrome.storage.sync.set({ apiBase: val }, () => {
    showMsg('Saqlandi ✓', true)
    checkApiHealth(val)
  })
})

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click()
})

function showMsg(text, ok) {
  saveMsg.textContent = text
  saveMsg.className = 'save-msg ' + (ok ? 'save-msg--ok' : 'save-msg--err')
  setTimeout(() => { saveMsg.textContent = '' }, 2500)
}

// ── Ping /healthz to show connection status ────────────────────────────────────
async function checkApiHealth(base) {
  setBadge('checking')
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(4000) })
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
