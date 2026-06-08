import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { focusActiveTerminal, sendTerminalInput } from '@/components/terminal/TerminalView'
import { useTerminalSessionStore } from '@/stores/terminal-session-store'

const CLIPBOARD_TEXT_TYPES = ['text/plain', 'text/uri-list', 'text/html'] as const

// Normalize clipboard payloads to plain text. GitHub's "Copy link" buttons (and
// many Mac copy-link UIs) write text/uri-list only, no text/plain, so the
// browser's default paste handler ends up with an empty payload.
function normalizeClipboardData(type: string, raw: string): string {
  if (type === 'text/uri-list') {
    return raw
      .split(/\r?\n/)
      .filter(l => l && !l.startsWith('#'))
      .join('\n')
  }
  if (type === 'text/html') {
    const doc = new DOMParser().parseFromString(raw, 'text/html')
    const href = doc.querySelector('a[href]')?.getAttribute('href')
    if (href) return href
    return doc.body?.textContent?.trim() ?? ''
  }
  return raw
}

function extractClipboardText(cd: DataTransfer | null): string {
  if (!cd) return ''
  for (const ty of CLIPBOARD_TEXT_TYPES) {
    const raw = cd.getData(ty)
    if (raw) {
      const normalized = normalizeClipboardData(ty, raw)
      if (normalized) return normalized
    }
  }
  return ''
}

/**
 * Read the clipboard and write it into the active terminal. Clipboard API first
 * (doesn't require focus, so the soft keyboard stays up); execCommand('paste')
 * fallback for insecure/Safari contexts. Returns true on success.
 */
async function pasteIntoTerminal(): Promise<boolean> {
  // Path A: Clipboard API (HTTPS only on iOS, but doesn't pop the keyboard).
  if (typeof window !== 'undefined' && window.isSecureContext) {
    try {
      const clip = navigator.clipboard
      if (clip?.read) {
        const items = await clip.read()
        for (const item of items) {
          for (const ty of CLIPBOARD_TEXT_TYPES) {
            if (!item.types.includes(ty)) continue
            const text = normalizeClipboardData(ty, await (await item.getType(ty)).text())
            if (text) {
              sendTerminalInput(text)
              return true
            }
          }
        }
      } else if (clip?.readText) {
        const text = await clip.readText()
        if (text) {
          sendTerminalInput(text)
          return true
        }
      }
    } catch {
      // Permission denied / no focus — fall through to execCommand.
    }
  }

  // Path B: execCommand('paste') fallback. Reuse a focused editable if there is
  // one (keeps the keyboard up); otherwise borrow the active xterm textarea
  // flipped readonly so iOS won't pop the keyboard.
  const activeEl = document.activeElement
  const activeIsEditable =
    activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement
  const target = activeIsEditable
    ? (activeEl as HTMLElement)
    : (document.querySelector('.xterm textarea') as HTMLTextAreaElement | null)
  if (!target) return false

  let recovered = ''
  const onPaste = (e: Event) => {
    recovered = extractClipboardText((e as ClipboardEvent).clipboardData)
  }
  target.addEventListener('paste', onPaste, { once: true })
  const ta = target instanceof HTMLTextAreaElement && !activeIsEditable ? target : null
  const prevReadOnly = ta?.readOnly
  if (ta) {
    ta.readOnly = true
    try {
      ta.focus({ preventScroll: true })
    } catch {
      /* focus may throw */
    }
  }
  try {
    document.execCommand('paste')
  } catch {
    /* unsupported */
  }
  if (ta) {
    ta.readOnly = prevReadOnly ?? false
    ta.blur()
  }
  target.removeEventListener('paste', onPaste)
  if (recovered) {
    sendTerminalInput(recovered)
    return true
  }
  return false
}

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
          onClick={() => {
            sendTerminalInput(k.seq)
            focusActiveTerminal()
          }}
          className="shrink-0 h-9 min-w-[40px] rounded-lg border border-border bg-card px-2.5 text-[13px] text-foreground/80 active:bg-accent-brand/10"
        >
          {k.label}
        </button>
      ))}
      <button
        type="button"
        aria-label={t('dock.paste')}
        title={t('dock.paste')}
        // Don't steal focus from the xterm textarea — keeps the keyboard up.
        onMouseDown={e => e.preventDefault()}
        onClick={() => {
          void pasteIntoTerminal()
        }}
        className="shrink-0 inline-flex h-9 min-w-[40px] items-center justify-center rounded-lg border border-border bg-card px-2.5 text-foreground/80 active:bg-accent-brand/10"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="2" width="6" height="4" rx="1" />
          <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
        </svg>
      </button>
    </div>
  )
}
