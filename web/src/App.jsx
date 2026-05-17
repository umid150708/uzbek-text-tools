import { useCallback, useRef, useState } from 'react'
import Editor from './components/Editor'
import AnalysisPanel from './components/AnalysisPanel'
import { checkText, transliterateText } from './lib/api'

export default function App() {
  // ── State ────────────────────────────────────────────────────────────────
  const [errors, setErrors] = useState([])
  const [totalWords, setTotalWords] = useState(0)
  const [loading, setLoading] = useState(false)
  const [script, setScript] = useState('latin')   // 'latin' | 'cyrillic'

  // Ref to the current plain text — kept in a ref (not state) so we can read
  // it synchronously inside callbacks without stale-closure problems.
  const currentTextRef = useRef('')

  // Ref to the Editor's imperative API (setText)
  const editorRef = useRef(null)

  // ── Spell-check helper ───────────────────────────────────────────────────
  const runCheck = useCallback(async (text) => {
    if (!text.trim()) {
      setErrors([])
      setTotalWords(0)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await checkText(text)
      setErrors(result.errors)
      setTotalWords(result.total_words)
    } catch (err) {
      console.error('Spell-check failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Called by Editor 600ms after user stops typing ───────────────────────
  const handleTextChange = useCallback(
    (text) => {
      currentTextRef.current = text
      runCheck(text)
    },
    [runCheck],
  )

  // ── Accept a suggestion (from Editor dropdown OR AnalysisPanel chip) ─────
  const handleAccept = useCallback(
    (suggestion, start, end) => {
      const text = currentTextRef.current
      const newText = text.slice(0, start) + suggestion + text.slice(end)
      currentTextRef.current = newText

      // Push new text into the editor without triggering onTextChange
      editorRef.current?.setText(newText)

      // Re-check immediately with the corrected text
      runCheck(newText)
    },
    [runCheck],
  )

  // ── Transliterate the whole editor content ────────────────────────────────
  const handleToggleScript = useCallback(async () => {
    const text = currentTextRef.current
    if (!text.trim()) {
      setScript((s) => (s === 'latin' ? 'cyrillic' : 'latin'))
      return
    }

    const mode = script === 'latin' ? 'latin-to-cyrillic' : 'cyrillic-to-latin'
    setLoading(true)
    try {
      const result = await transliterateText(text, mode)
      currentTextRef.current = result.converted
      editorRef.current?.setText(result.converted)
      setScript((s) => (s === 'latin' ? 'cyrillic' : 'latin'))

      // Spell-check only makes sense for Latin script
      if (mode === 'cyrillic-to-latin') {
        await runCheck(result.converted)
      } else {
        setErrors([])
        setTotalWords(0)
        setLoading(false)
      }
    } catch (err) {
      console.error('Transliteration failed:', err)
      setLoading(false)
    }
  }, [script, runCheck])

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Top bar ── */}
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-accent">O'z</span>Tekshiruv
        </div>

        <div className="topbar-controls">
          <button
            className={`script-toggle ${loading ? 'script-toggle--loading' : ''}`}
            onClick={handleToggleScript}
            disabled={loading}
            title="Yozuvni o'zgartirish"
          >
            <span className={`script-label ${script === 'latin' ? 'active' : ''}`}>
              Latin
            </span>
            <span className="toggle-divider">⇄</span>
            <span className={`script-label ${script === 'cyrillic' ? 'active' : ''}`}>
              Кирилл
            </span>
          </button>
        </div>
      </header>

      {/* ── Main two-panel layout ── */}
      <main className="main">
        {/* Left: editor */}
        <section className="editor-panel panel">
          <div className="panel-header">
            <span className="panel-title">Matn</span>
            <span className="panel-hint">
              {script === 'latin' ? 'Lotin yozuvi' : 'Кирилл ёзуви'}
            </span>
          </div>
          <Editor
            ref={editorRef}
            errors={script === 'latin' ? errors : []}
            onTextChange={handleTextChange}
            onAccept={handleAccept}
          />
        </section>

        {/* Right: analysis */}
        <AnalysisPanel
          totalWords={totalWords}
          errorsFound={errors.length}
          errors={script === 'latin' ? errors : []}
          loading={loading}
          onAccept={handleAccept}
        />
      </main>
    </div>
  )
}
