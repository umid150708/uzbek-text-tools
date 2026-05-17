import { useCallback, useRef, useState } from 'react'
import Editor from './components/Editor'
import AnalysisPanel from './components/AnalysisPanel'
import { checkText, transliterateText } from './lib/api'

export default function App() {
  // ── State ────────────────────────────────────────────────────────────────
  const [errors, setErrors]           = useState([])
  const [totalWords, setTotalWords]   = useState(0)
  const [loading, setLoading]         = useState(false)
  const [script, setScript]           = useState('latin')   // 'latin' | 'cyrillic'
  const [currentText, setCurrentText] = useState('')

  // Set of "word:start" keys that the user has clicked "Ignore" on.
  // Reset on every new check so stale ignores don't persist across edits.
  const [ignoredKeys, setIgnoredKeys] = useState(new Set())

  // Ref to plain text — synchronous access inside callbacks (no stale closure)
  const currentTextRef = useRef('')

  // Ref to Editor's imperative setText()
  const editorRef = useRef(null)

  // Errors with user-ignored items removed
  const visibleErrors = errors.filter(
    (e) => !ignoredKeys.has(`${e.word}:${e.start}`),
  )

  // ── Spell-check helper ───────────────────────────────────────────────────
  const runCheck = useCallback(async (text) => {
    setIgnoredKeys(new Set())   // clear ignored list whenever we re-check
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

  // ── Called by Editor 600 ms after the user stops typing ─────────────────
  const handleTextChange = useCallback(
    (text) => {
      currentTextRef.current = text
      setCurrentText(text)
      runCheck(text)
    },
    [runCheck],
  )

  // ── Accept a single suggestion ───────────────────────────────────────────
  const handleAccept = useCallback(
    (suggestion, start, end) => {
      const text    = currentTextRef.current
      const newText = text.slice(0, start) + suggestion + text.slice(end)
      currentTextRef.current = newText
      setCurrentText(newText)
      editorRef.current?.setText(newText)
      runCheck(newText)
    },
    [runCheck],
  )

  // ── Ignore a single error (hide its card without changing text) ──────────
  const handleIgnore = useCallback((word, start) => {
    setIgnoredKeys((prev) => new Set([...prev, `${word}:${start}`]))
  }, [])

  // ── Accept ALL visible suggestions (apply from last → first) ────────────
  const handleAcceptAll = useCallback(() => {
    if (visibleErrors.length === 0) return
    const text = currentTextRef.current

    // Sort descending by start so earlier offsets stay valid as we splice
    const sorted = [...visibleErrors]
      .filter((e) => e.suggestions.length > 0)
      .sort((a, b) => b.start - a.start)

    let newText = text
    for (const err of sorted) {
      newText =
        newText.slice(0, err.start) + err.suggestions[0] + newText.slice(err.end)
    }

    currentTextRef.current = newText
    setCurrentText(newText)
    editorRef.current?.setText(newText)
    runCheck(newText)
  }, [visibleErrors, runCheck])

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
      setCurrentText(result.converted)
      editorRef.current?.setText(result.converted)
      setScript((s) => (s === 'latin' ? 'cyrillic' : 'latin'))

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
            errors={script === 'latin' ? visibleErrors : []}
            onTextChange={handleTextChange}
            onAccept={handleAccept}
          />
        </section>

        {/* Right: analysis */}
        <AnalysisPanel
          totalWords={totalWords}
          errors={script === 'latin' ? visibleErrors : []}
          loading={loading}
          onAccept={handleAccept}
          onIgnore={handleIgnore}
          onAcceptAll={handleAcceptAll}
          currentText={currentText}
        />

      </main>
    </div>
  )
}
