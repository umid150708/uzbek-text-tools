import { useEffect, useRef } from 'react'

/**
 * Floating dropdown showing spell-check suggestions.
 * Positioned with `position: fixed` so it escapes panel overflow clipping.
 */
export default function SuggestionDropdown({ x, y, suggestions, onAccept, onDismiss }) {
  const ref = useRef(null)

  // Close on click outside
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        onDismiss()
      }
    }
    // Small delay so the click that opened us doesn't immediately close us
    const id = setTimeout(() => document.addEventListener('mousedown', handleClick), 10)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onDismiss])

  // Prevent dropdown from going off the right edge of the viewport
  const vpWidth = window.innerWidth
  const dropWidth = 200
  const adjustedX = Math.min(x, vpWidth - dropWidth - 12)

  return (
    <div
      ref={ref}
      className="suggestion-dropdown"
      style={{ left: adjustedX, top: y + 6 }}
    >
      <div className="suggestion-label">Tavsiyalar</div>
      {suggestions.length === 0 ? (
        <div className="suggestion-empty">Tavsiya topilmadi</div>
      ) : (
        suggestions.map((s) => (
          <button key={s} className="suggestion-item" onClick={() => onAccept(s)}>
            {s}
          </button>
        ))
      )}
    </div>
  )
}
