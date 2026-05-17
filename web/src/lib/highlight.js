/**
 * highlight.js
 * Build an HTML string from raw text + a list of error spans.
 * Error words are wrapped in <span class="error"> with data attributes
 * that the Editor uses to show suggestion dropdowns.
 */

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {string} text  - the plain text (innerText of the editor)
 * @param {Array}  errors - [{word, start, end, suggestions}, ...]
 * @returns {string} innerHTML with <span class="error"> wrappers
 */
export function buildHighlightedHTML(text, errors) {
  if (!errors || errors.length === 0) return escapeHtml(text)

  // Sort by start offset (API already returns sorted, but be safe)
  const sorted = [...errors].sort((a, b) => a.start - b.start)

  let html = ''
  let pos = 0

  for (const err of sorted) {
    // Skip malformed entries
    if (err.start < pos || err.end > text.length) continue

    // Text before this error
    html += escapeHtml(text.slice(pos, err.start))

    // Error span — embed suggestions as JSON in a data attribute
    const suggestionsJson = escapeHtml(JSON.stringify(err.suggestions))
    html += `<span class="error" data-start="${err.start}" data-end="${err.end}" data-suggestions="${suggestionsJson}">${escapeHtml(err.word)}</span>`

    pos = err.end
  }

  // Remaining text after last error
  html += escapeHtml(text.slice(pos))

  return html
}
