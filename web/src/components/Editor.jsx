import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { getCaretOffset, setCaretOffset } from '../lib/cursorUtils'
import { buildHighlightedHTML } from '../lib/highlight'
import SuggestionDropdown from './SuggestionDropdown'

/**
 * Editor — a contenteditable div with:
 *   • live error underlines (injected as <span class="error"> after each API call)
 *   • click-to-suggest dropdown on any underlined word
 *   • 600 ms debounce before notifying the parent of text changes
 *
 * Props
 *   errors        [{word, start, end, suggestions}]  from last API response
 *   onTextChange  (text: string) → void              called 600ms after user stops typing
 *   onAccept      (suggestion, start, end) → void    called when user picks a suggestion
 *
 * Ref API (via forwardRef + useImperativeHandle)
 *   setText(newText)   replace the editor content without triggering onTextChange
 */
const Editor = forwardRef(function Editor({ errors, onTextChange, onAccept }, ref) {
  const editorRef = useRef(null)
  // Canonical plain text — kept in a ref so it doesn't trigger re-renders
  const lastTextRef = useRef('')
  const debounceRef = useRef(null)
  const [dropdown, setDropdown] = useState(null) // { x, y, suggestions, start, end }

  // ── Expose setText to parent (used for transliterate / accept-suggestion) ──
  useImperativeHandle(ref, () => ({
    setText(newText) {
      const el = editorRef.current
      if (!el) return
      lastTextRef.current = newText
      // Set raw text; highlight injection happens via the `errors` effect below
      el.innerText = newText
    },
  }))

  // ── Re-inject highlights whenever errors change ──────────────────────────
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const text = lastTextRef.current
    if (!text.trim()) {
      el.innerHTML = ''
      return
    }

    // Save cursor, rebuild HTML, restore cursor
    const offset = getCaretOffset(el)
    el.innerHTML = buildHighlightedHTML(text, errors)
    setCaretOffset(el, offset)
  }, [errors])

  // ── Handle user typing ───────────────────────────────────────────────────
  const handleInput = useCallback(() => {
    const el = editorRef.current
    // innerText gives us the visible plain text, honouring any <br> / <div>
    // that the browser inserts on Enter.
    const text = el.innerText
    lastTextRef.current = text

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onTextChange(text)
    }, 600)
  }, [onTextChange])

  // ── Handle click on an underlined word ──────────────────────────────────
  const handleClick = useCallback((e) => {
    const span = e.target.closest('.error')
    if (!span) {
      setDropdown(null)
      return
    }
    const rect = span.getBoundingClientRect()
    const suggestions = JSON.parse(span.dataset.suggestions || '[]')
    setDropdown({
      x: rect.left,
      y: rect.bottom,
      suggestions,
      start: parseInt(span.dataset.start, 10),
      end: parseInt(span.dataset.end, 10),
    })
  }, [])

  // ── Accept a suggestion ──────────────────────────────────────────────────
  const handleAccept = useCallback(
    (suggestion) => {
      if (!dropdown) return
      onAccept(suggestion, dropdown.start, dropdown.end)
      setDropdown(null)
    },
    [dropdown, onAccept],
  )

  // ── Keyboard: Escape closes dropdown ────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') setDropdown(null)
  }, [])

  return (
    <div className="editor-wrapper">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="editor-area"
        data-placeholder="Yozishni boshlang..."
        onInput={handleInput}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        spellCheck={false}  // disable browser's own spellcheck; we do ours
      />
      {dropdown && (
        <SuggestionDropdown
          x={dropdown.x}
          y={dropdown.y}
          suggestions={dropdown.suggestions}
          onAccept={handleAccept}
          onDismiss={() => setDropdown(null)}
        />
      )}
    </div>
  )
})

export default Editor
