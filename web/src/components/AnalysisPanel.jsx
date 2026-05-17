/**
 * AnalysisPanel — QuillBot / Google Docs–style right-hand panel.
 *
 * Each error is shown as a card with:
 *   • a category label
 *   • original word (struck-through red) → top suggestion (bold green)
 *   • a short context snippet from the source text
 *   • alternative suggestion chips (2nd and 3rd suggestions)
 *   • "Qabul" (Accept) and "E'tiborsiz" (Ignore) buttons
 *
 * The header has an error-count badge, a loading spinner, and an
 * "Accept all" button that applies every card's top suggestion at once.
 */

// ── helpers ─────────────────────────────────────────────────────────────────

function normalize(str) {
  return str.toLowerCase().replace(/[''ʻʼ]/g, "'")
}

/** Derive a human-readable category from the error/suggestion pair. */
function getCategory(word, suggestion) {
  const w = normalize(word)
  const s = normalize(suggestion)

  // Only apostrophe difference → flag it explicitly
  if (w.replace(/'/g, '') === s.replace(/'/g, '')) return "Apostrof belgisi"

  // Short form / truncated word
  if (Math.abs(w.length - s.length) > 3) return "To'liqsiz so'z"

  return "Imlo xatosi"
}

/** Extract ~30 chars of context around the error span. */
function getContext(text, start, end, win = 30) {
  const before = text.slice(Math.max(0, start - win), start)
  const after  = text.slice(end, Math.min(text.length, end + win))
  return {
    before: start > win   ? '…' + before : before,
    after:  end + win < text.length ? after + '…' : after,
  }
}

// ── component ────────────────────────────────────────────────────────────────

export default function AnalysisPanel({
  totalWords,
  errors,        // already filtered (ignored ones removed by App)
  loading,
  onAccept,
  onIgnore,
  onAcceptAll,
  currentText,   // plain text string, used for context snippets
}) {
  const count   = errors.length
  const allClear = !loading && count === 0 && totalWords > 0

  return (
    <aside className="analysis-panel">

      {/* ── Header ── */}
      <div className="ap-header">
        <div className="ap-title-row">
          <span className="ap-title">Imlo tekshiruvi</span>
          {count > 0 && <span className="ap-badge">{count}</span>}
          {loading && <span className="spinner" title="Tekshirilmoqda…" />}
        </div>

        {count > 0 && (
          <button className="ap-accept-all-btn" onClick={onAcceptAll}>
            ✓ Barchasini qabul qilish
          </button>
        )}

        {/* Stats row */}
        <div className="ap-stats">
          <span className="ap-stat">
            <strong>{totalWords}</strong> so'z
          </span>
          <span className={`ap-stat ${count > 0 ? 'ap-stat--error' : ''}`}>
            <strong>{count}</strong> xato
          </span>
        </div>
      </div>

      {/* ── All-clear banner ── */}
      {allClear && (
        <div className="all-clear">
          <span className="all-clear-icon">✓</span>
          Xatolar topilmadi
        </div>
      )}

      {/* ── Error cards ── */}
      <div className="ap-card-list">
        {errors.map((err) => {
          const [top, ...rest] = err.suggestions
          if (!top) return null

          const category = getCategory(err.word, top)
          const { before, after } = currentText
            ? getContext(currentText, err.start, err.end)
            : { before: '', after: '' }

          return (
            <div key={`${err.start}:${err.word}`} className="ap-card">

              {/* Category label */}
              <div className="ap-card-category">{category}</div>

              {/* word → suggestion */}
              <div className="ap-card-correction">
                <span className="ap-wrong">{err.word}</span>
                <span className="ap-arrow">→</span>
                <span className="ap-right">{top}</span>
              </div>

              {/* Context snippet */}
              {currentText && (
                <div className="ap-context">
                  <span className="ap-ctx-plain">{before}</span>
                  <span className="ap-ctx-error">{err.word}</span>
                  <span className="ap-ctx-plain">{after}</span>
                </div>
              )}

              {/* Alternative suggestions */}
              {rest.length > 0 && (
                <div className="ap-alts">
                  {rest.map((s) => (
                    <button
                      key={s}
                      className="ap-alt-chip"
                      onClick={() => onAccept(s, err.start, err.end)}
                      title={`"${s}" bilan almashtirish`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="ap-card-actions">
                <button
                  className="ap-btn ap-btn--accept"
                  onClick={() => onAccept(top, err.start, err.end)}
                >
                  ✓ Qabul
                </button>
                <button
                  className="ap-btn ap-btn--ignore"
                  onClick={() => onIgnore(err.word, err.start)}
                >
                  E'tiborsiz
                </button>
              </div>

            </div>
          )
        })}
      </div>

      {/* ── Empty state (no text entered yet) ── */}
      {!loading && totalWords === 0 && (
        <p className="empty-hint">
          Chap tomonga matn kiriting — xatolar shu yerda ko'rinadi.
        </p>
      )}
    </aside>
  )
}
