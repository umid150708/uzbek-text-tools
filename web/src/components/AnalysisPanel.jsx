/**
 * AnalysisPanel — right-side panel.
 * Shows a word/error counter and a scrollable list of every error with its
 * top-3 suggestion chips.  Clicking a chip calls onAccept which bubbles up
 * to App → Editor.
 */
export default function AnalysisPanel({
  totalWords,
  errorsFound,
  errors,
  loading,
  onAccept,
}) {
  const allClear = !loading && errorsFound === 0 && totalWords > 0

  return (
    <aside className="analysis-panel">
      <div className="analysis-header">
        <h2 className="panel-title">Tahlil</h2>
        {loading && <span className="spinner" title="Tekshirilmoqda..." />}
      </div>

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-number">{totalWords}</span>
          <span className="stat-label">so'z</span>
        </div>
        <div className={`stat-card ${errorsFound > 0 ? 'stat-error' : ''}`}>
          <span className="stat-number">{errorsFound}</span>
          <span className="stat-label">xato</span>
        </div>
      </div>

      {/* All-clear banner */}
      {allClear && (
        <div className="all-clear">
          <span className="all-clear-icon">✓</span>
          Xatolar topilmadi
        </div>
      )}

      {/* Error list */}
      {errors.length > 0 && (
        <ul className="error-list">
          {errors.map((err) => (
            <li key={`${err.start}-${err.word}`} className="error-item">
              <span className="error-word">{err.word}</span>
              <div className="suggestion-chips">
                {err.suggestions.map((s) => (
                  <button
                    key={s}
                    className="chip"
                    onClick={() => onAccept(s, err.start, err.end)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Empty state before first check */}
      {!loading && totalWords === 0 && (
        <p className="empty-hint">
          Chap tomonga matn kiriting — xatolar shu yerda ko'rinadi.
        </p>
      )}
    </aside>
  )
}
