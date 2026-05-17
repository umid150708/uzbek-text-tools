/**
 * cursorUtils.js
 * Save and restore cursor position (as a character offset) inside a
 * contenteditable element whose innerHTML may be rebuilt.
 *
 * Both functions walk every text node inside `el`, counting characters,
 * so they work correctly across plain text nodes, <span> children, and
 * nested elements introduced by the browser when the user presses Enter.
 */

/**
 * Return the caret position as a character offset from the start of `el`.
 * Returns 0 if there is no selection or the selection is outside `el`.
 */
export function getCaretOffset(el) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0

  const range = sel.getRangeAt(0)

  // Verify the selection is inside our element
  if (!el.contains(range.endContainer)) return 0

  // Clone the range from the start of el to the current end
  const preRange = range.cloneRange()
  preRange.selectNodeContents(el)
  preRange.setEnd(range.endContainer, range.endOffset)

  return preRange.toString().length
}

/**
 * Move the caret to `offset` characters from the start of `el`.
 * If `offset` exceeds the total text length, the caret goes to the end.
 */
export function setCaretOffset(el, offset) {
  const sel = window.getSelection()
  if (!sel) return

  const range = document.createRange()
  let remaining = offset
  let placed = false

  // Walk text nodes in document order
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node

  while ((node = walker.nextNode())) {
    const len = node.textContent.length
    if (remaining <= len) {
      range.setStart(node, remaining)
      range.collapse(true)
      placed = true
      break
    }
    remaining -= len
  }

  if (!placed) {
    // Offset is past the end — put cursor at the very end
    range.selectNodeContents(el)
    range.collapse(false)
  }

  sel.removeAllRanges()
  sel.addRange(range)
}
