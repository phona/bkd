import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sendTerminalInput } from '@/components/terminal/TerminalView'
import { useTerminalSessionStore } from '@/stores/terminal-session-store'

// Escape sequences for the helper keys. Arrows use the standard ANSI cursor
// codes; Esc/Tab send their literal control bytes; symbols are inserted as-is.
const KEYS: Array<{ label: string, seq: string }> = [
  { label: 'Esc', seq: '\x1B' },
  { label: 'Tab', seq: '\t' },
  { label: '↑', seq: '\x1B[A' },
  { label: '↓', seq: '\x1B[B' },
  { label: '←', seq: '\x1B[D' },
  { label: '→', seq: '\x1B[C' },
  { label: '|', seq: '|' },
  { label: '~', seq: '~' },
  { label: '/', seq: '/' },
  { label: '-', seq: '-' },
]

const LONG_PRESS_MS = 400

/**
 * Mobile terminal helper key bar (PLAN-036): sits just above the soft
 * keyboard (visualViewport-aware) and feeds escape sequences to the live PTY.
 *
 * The Ctrl key is a sticky modifier handled by TerminalView's onData:
 *  - tap      → one-shot (applies to the next typed key, then clears)
 *  - long-press → lock (stays armed until tapped off)
 */
export function TerminalKeyBar() {
  const { t } = useTranslation()
  const ctrlMode = useTerminalSessionStore(s => s.ctrlMode)
  const [kbInset, setKbInset] = useState(0)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressedRef = useRef(false)

  // Keep the bar pinned above the on-screen keyboard. Mirrors the
  // visualViewport handling in ChatInput: the gap between the layout viewport
  // and the visual viewport bottom is the keyboard height.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKbInset(inset)
    }
    onResize()
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])

  const setCtrl = useCallback((mode: 'off' | 'once' | 'lock') => {
    useTerminalSessionStore.getState().set({ ctrlMode: mode })
  }, [])

  const onCtrlPointerDown = useCallback(() => {
    longPressedRef.current = false
    longPressRef.current = setTimeout(() => {
      longPressedRef.current = true
      setCtrl('lock')
    }, LONG_PRESS_MS)
  }, [setCtrl])

  const clearLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }, [])

  const onCtrlClick = useCallback(() => {
    // A long-press already locked it via the timer — swallow the click.
    if (longPressedRef.current) {
      longPressedRef.current = false
      return
    }
    const current = useTerminalSessionStore.getState().ctrlMode
    setCtrl(current === 'off' ? 'once' : 'off')
  }, [setCtrl])

  return (
    <div
      className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-border bg-muted/60 px-2.5 py-2"
      style={{ marginBottom: kbInset }}
    >
      <button
        type="button"
        title={t('dock.ctrlHint')}
        onPointerDown={onCtrlPointerDown}
        onPointerUp={clearLongPress}
        onPointerLeave={clearLongPress}
        onClick={onCtrlClick}
        className={`shrink-0 h-9 min-w-[42px] rounded-lg border px-2.5 text-[13px] font-medium transition-colors ${
          ctrlMode !== 'off'
            ? 'border-accent-brand bg-accent-brand text-white'
            : 'border-border bg-card text-foreground/80'
        }`}
      >
        {ctrlMode === 'lock' ? 'Ctrl•' : 'Ctrl'}
      </button>
      {KEYS.map(k => (
        <button
          key={k.label}
          type="button"
          // Keep the terminal focused: pressing a helper key must not blur the
          // hidden xterm textarea (which would dismiss the keyboard).
          onMouseDown={e => e.preventDefault()}
          onClick={() => sendTerminalInput(k.seq)}
          className="shrink-0 h-9 min-w-[40px] rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground/80 active:bg-accent-brand/10"
        >
          {k.label}
        </button>
      ))}
    </div>
  )
}
