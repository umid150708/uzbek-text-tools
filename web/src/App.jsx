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
  const [ignoredKeys, setIgnoredKeys] = useState(new Set())

  // Synchronous plain-text access inside callbacks
  const currentTextRef = useRef('')
  // Editor's imperative setText()
  const editorRef = useRef(null)

  /**
   * Latin state cache — saved when the user switches Latin→Cyrillic so we can
   * restore it instantly if they switch back without editing in Cyrillic mode.
   *
   * Shape: {
   *   text:        string,   // Latin plain text
   *   errors:      Error[],  // API errors for that text
   *   totalWords:  number,
   *   ignoredKeys: Set,      // which cards the user dismissed
   *   cyrillicText: string,  // the Cyrillic version produced at toggle time
   * }
   */
  const latinCacheRef = useRef(null)

  // Errors with user-ignored items removed
  const visibleErrors = errors.filter(
    (e) => !ignoredKeys.has(`${e.word}:${e.start}`),
  )

  // ── Spell-check helper ───────────────────────────────────────────────────
  const runCheck = useCallback(async (text) => {
    setIgnoredKeys(new Set())
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

  // ── Called by Editor 600 ms after the user stops typing ──────────────────
  const handleTextChange = useCallback(
    (text) => {
      currentTextRef.current = text
      setCurrentText(text)
      // Typing in Latin after a restore → invalidate cache so next toggle
      // will save fresh state (not the stale restored one)
      latinCacheRef.current = null
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
      latinCacheRef.current = null   // text changed → old cache is stale
      runCheck(newText)
    },
    [runCheck],
  )

  // ── Ignore a single error card ───────────────────────────────────────────
  const handleIgnore = useCallback((word, start) => {
    setIgnoredKeys((prev) => new Set([...prev, `${word}:${start}`]))
  }, [])

  // ── Accept ALL visible suggestions ──────────────────────────────────────
  const handleAcceptAll = useCallback(() => {
    if (visibleErrors.length === 0) return
    const text   = currentTextRef.current
    const sorted = [...visibleErrors]
      .filter((e) => e.suggestions.length > 0)
      .sort((a, b) => b.start - a.start)

    let newText = text
    for (const err of sorted) {
      newText = newText.slice(0, err.start) + err.suggestions[0] + newText.slice(err.end)
    }

    currentTextRef.current = newText
    setCurrentText(newText)
    editorRef.current?.setText(newText)
    latinCacheRef.current = null
    runCheck(newText)
  }, [visibleErrors, runCheck])

  // ── Toggle Latin ↔ Cyrillic with state preservation ──────────────────────
  const handleToggleScript = useCallback(async () => {
    const text = currentTextRef.current

    // ── Empty editor — just flip the label ──
    if (!text.trim()) {
      setScript((s) => (s === 'latin' ? 'cyrillic' : 'latin'))
      return
    }

    // ── Latin → Cyrillic ─────────────────────────────────────────────────
    if (script === 'latin') {
      // Snapshot the full Latin state BEFORE switching
      latinCacheRef.current = {
        text,
        errors,
        totalWords,
        ignoredKeys,
        cyrillicText: null,   // filled after transliteration
      }

      setLoading(true)
      try {
        const result = await transliterateText(text, 'latin-to-cyrillic')
        // Store the Cyrillic version so we can detect edits later
        latinCacheRef.current.cyrillicText = result.converted

        currentTextRef.current = result.converted
        setCurrentText(result.converted)
        editorRef.current?.setText(result.converted)
        setScript('cyrillic')
        setErrors([])        // no error highlighting in Cyrillic mode
        setTotalWords(0)
      } catch (err) {
        console.error('Transliteration failed:', err)
        latinCacheRef.current = null
      } finally {
        setLoading(false)
      }
      return
    }

    // ── Cyrillic → Latin ─────────────────────────────────────────────────
    const cache = latinCacheRef.current

    if (cache && cache.cyrillicText && text === cache.cyrillicText) {
      // ── Fast path: user didn't edit in Cyrillic → restore instantly ──
      currentTextRef.current = cache.text
      setCurrentText(cache.text)
      editorRef.current?.setText(cache.text)
      setErrors(cache.errors)
      setTotalWords(cache.totalWords)
      setIgnoredKeys(cache.ignoredKeys)
      setScript('latin')
      latinCacheRef.current = null
      return
    }

    // ── Slow path: Cyrillic text was edited → re-translate + re-check ──
    setLoading(true)
    try {
      const result = await transliterateText(text, 'cyrillic-to-latin')
      currentTextRef.current = result.converted
      setCurrentText(result.converted)
      editorRef.current?.setText(result.converted)
      setScript('latin')
      latinCacheRef.current = null
      await runCheck(result.converted)
    } catch (err) {
      console.error('Transliteration failed:', err)
      setLoading(false)
    }
  }, [script, errors, totalWords, ignoredKeys, runCheck])

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
