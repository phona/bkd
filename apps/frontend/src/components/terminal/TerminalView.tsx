import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useRef } from 'react'
import { getToken } from '@/lib/auth'
import { useTerminalSessionStore } from '@/stores/terminal-session-store'
import { useTerminalStore } from '@/stores/terminal-store'
import '@xterm/xterm/css/xterm.css'

// --- Terminal themes ---

const DARK_THEME = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  cursorAccent: '#0d1117',
  selectionBackground: '#264f78',
  selectionForeground: '#e6edf3',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
} as const

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#1f2328',
  cursorAccent: '#ffffff',
  selectionBackground: '#0969da33',
  selectionForeground: '#1f2328',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#4d2d00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f',
} as const

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

function getTerminalTheme() {
  return isDarkMode() ? DARK_THEME : LIGHT_THEME
}

// --- Binary protocol helpers ---

function encodeInput(data: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(data)
  const buf = new Uint8Array(1 + encoded.length)
  buf[0] = 0x00
  buf.set(encoded, 1)
  return buf.buffer
}

/**
 * Map a single printable character to its ASCII control code (Ctrl+X).
 * `a`/`A` → 0x01 … `z`/`Z` → 0x1a, plus the standard @[\]^_ range.
 * Non-single or non-mappable input passes through untouched.
 */
function applyCtrl(data: string): string {
  if (data.length !== 1) return data
  const code = data.toUpperCase().charCodeAt(0)
  if (code >= 0x40 && code <= 0x5F) return String.fromCharCode(code & 0x1F)
  return data
}

/**
 * Send a raw input sequence to the live terminal PTY (mobile helper keys:
 * Esc / Tab / arrows / symbols). No-op when the socket is not open.
 */
export function sendTerminalInput(data: string): void {
  const { ws } = useTerminalSessionStore.getState()
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(encodeInput(data))
  }
}

function encodeResize(cols: number, rows: number): ArrayBuffer {
  const buf = new ArrayBuffer(5)
  const view = new DataView(buf)
  view.setUint8(0, 0x01)
  view.setUint16(1, cols, false)
  view.setUint16(3, rows, false)
  return buf
}

// --- Session persistence ---

const SESSION_STORAGE_KEY = 'bkd-terminal-session-id'

function saveSessionId(id: string): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, id)
  } catch {
    /* quota */
  }
}

function loadSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function clearSessionId(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    /* */
  }
}

// --- API helpers ---

function terminalHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function createSession(cwd?: string | null): Promise<string> {
  const headers = terminalHeaders()
  let body: string | undefined
  if (cwd) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({ cwd })
  }
  const res = await fetch('/api/terminal', { method: 'POST', headers, body })
  const json = await res.json()
  if (!json.success) throw new Error(json.error)
  return json.data.id as string
}

async function checkSession(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/terminal/${id}`, { headers: terminalHeaders() })
    const json = await res.json()
    return json.success === true
  } catch {
    return false
  }
}

function deleteSession(sessionId: string): void {
  clearSessionId()
  void fetch(`/api/terminal/${sessionId}`, { method: 'DELETE', headers: terminalHeaders() })
}

function wsUrl(sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  // Bun runtime lacks socket.destroySoon() — Vite WS proxy crashes.
  // In dev mode, connect directly to API server to bypass Vite proxy.
  const host = import.meta.env.DEV ?
    `${location.hostname}:${import.meta.env.VITE_API_PORT || 3010}` :
    location.host
  const base = `${proto}//${host}/api/terminal/ws/${sessionId}`
  // Pass auth token as query param (WebSocket doesn't support custom headers)
  const token = getToken()
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

// --- Store-backed singleton helpers ---

const store = useTerminalSessionStore

function getOrCreateTerminal(): { terminal: Terminal, fitAddon: FitAddon } {
  const state = store.getState()
  if (state.terminal && state.fitAddon) {
    return { terminal: state.terminal, fitAddon: state.fitAddon }
  }

  store.getState().set({ disposed: false })

  const fitAddon = new FitAddon()
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily:
      'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
    theme: getTerminalTheme(),
    allowProposedApi: true,
  })

  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())
  terminal.loadAddon(new ImageAddon())

  store.getState().set({ terminal, fitAddon })

  return { terminal, fitAddon }
}

/** Try to enable GPU-accelerated WebGL rendering */
function tryLoadWebgl(terminal: Terminal): void {
  try {
    const webglAddon = new WebglAddon()
    webglAddon.onContextLoss(() => {
      webglAddon.dispose()
    })
    terminal.loadAddon(webglAddon)
  } catch {
    // WebGL not available — falls back to canvas renderer
  }
}

let wsRetryCount = 0

function connectWs(sessionId: string, terminal: Terminal, fitAddon: FitAddon): void {
  const state = store.getState()
  if (state.disposed) return
  if (
    state.ws &&
    (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  const ws = new WebSocket(wsUrl(sessionId))
  ws.binaryType = 'arraybuffer'
  store.getState().set({ ws })

  ws.addEventListener('open', () => {
    wsRetryCount = 0
    fitAddon.fit()
    const { cols, rows } = terminal
    ws.send(encodeResize(cols, rows))
  })

  ws.addEventListener('message', (evt) => {
    if (evt.data instanceof ArrayBuffer) {
      terminal.write(new Uint8Array(evt.data))
    }
  })

  ws.addEventListener('close', (evt) => {
    store.getState().set({ ws: null })

    // Replaced by another tab/connection — stop reconnecting
    if (evt.code === 4000) {
      clearSessionId()
      store.getState().set({ sessionId: null })
      terminal.writeln('\r\n\x1B[90m[session taken over by another tab]\x1B[0m')
      return
    }

    // Session is gone (PTY exited or server rejected) — start fresh
    if (evt.reason === 'PTY exited' || evt.code === 1008) {
      clearSessionId()
      store.getState().set({ sessionId: null })
      if (!store.getState().disposed) {
        terminal.writeln('\r\n\x1B[90m[session ended, reconnecting...]\x1B[0m')
        const timer = setTimeout(() => {
          store.getState().set({ reconnectTimer: null })
          void initConnection(terminal, fitAddon)
        }, 1500)
        store.getState().set({ reconnectTimer: timer })
      }
      return
    }

    // WS disconnected but session may still be alive — reconnect to same session
    const currentState = store.getState()
    if (!currentState.disposed && currentState.sessionId) {
      wsRetryCount++
      // Too many retries — session is likely dead, start fresh
      if (wsRetryCount >= 3) {
        wsRetryCount = 0
        clearSessionId()
        store.getState().set({ sessionId: null })
        const timer = setTimeout(() => {
          store.getState().set({ reconnectTimer: null })
          void initConnection(terminal, fitAddon)
        }, 1500)
        store.getState().set({ reconnectTimer: timer })
        return
      }
      const timer = setTimeout(() => {
        store.getState().set({ reconnectTimer: null })
        const s = store.getState()
        if (s.sessionId) {
          connectWs(s.sessionId, terminal, fitAddon)
        }
      }, 2000)
      store.getState().set({ reconnectTimer: timer })
    }
  })

  ws.addEventListener('error', () => {
    ws.close()
  })
}

async function initConnection(terminal: Terminal, fitAddon: FitAddon): Promise<void> {
  const state = store.getState()
  if (state.disposed) return

  // Already have a live session + WS — skip
  if (
    state.sessionId &&
    state.ws &&
    (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  // Deduplicate concurrent calls — wait for in-flight connection
  if (state.connecting) {
    await state.connecting
    return
  }

  const connectingPromise = (async () => {
    try {
      // A pending cwd (e.g. "open terminal in this worktree") forces a fresh
      // session in that directory instead of reconnecting to the global one.
      const pendingCwd = useTerminalStore.getState().pendingCwd
      const savedId = loadSessionId()
      let sessionId: string
      if (pendingCwd) {
        clearSessionId()
        sessionId = await createSession(pendingCwd)
        useTerminalStore.getState().clearPendingCwd()
      } else if (savedId && await checkSession(savedId)) {
        sessionId = savedId
        terminal.writeln('\r\n\x1B[90m[reconnected to existing session]\x1B[0m')
      } else {
        sessionId = await createSession()
      }
      saveSessionId(sessionId)
      store.getState().set({ sessionId })

      // Connect WS for bidirectional I/O
      connectWs(sessionId, terminal, fitAddon)
    } catch {
      const timer = setTimeout(() => {
        store.getState().set({ reconnectTimer: null })
        void initConnection(terminal, fitAddon)
      }, 2000)
      store.getState().set({ reconnectTimer: timer })
    } finally {
      store.getState().set({ connecting: null })
    }
  })()

  store.getState().set({ connecting: connectingPromise })

  await connectingPromise
}

/**
 * Tear down the current session and reconnect. Used when the terminal is asked
 * to switch directories (openInDir) while already open — the pending cwd in the
 * store makes initConnection start a fresh session there.
 */
async function restartConnection(): Promise<void> {
  const state = store.getState()
  if (state.ws) {
    try {
      state.ws.close()
    } catch {
      /* already closed */
    }
  }
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer)
  if (state.sessionId) deleteSession(state.sessionId)
  clearSessionId()
  store.getState().set({ sessionId: null, ws: null, connecting: null, reconnectTimer: null })

  const { terminal, fitAddon } = getOrCreateTerminal()
  terminal.reset()
  await initConnection(terminal, fitAddon)
}

export function TerminalView({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)
  const restartToken = useTerminalStore(s => s.restartToken)
  const seenRestartToken = useRef(restartToken)

  // openInDir bumps restartToken — when the terminal is already mounted, switch
  // to the requested directory by recreating the session. On a fresh mount the
  // pending cwd is consumed by initConnection, so skip the restart there.
  useEffect(() => {
    if (seenRestartToken.current === restartToken) return
    seenRestartToken.current = restartToken
    if (!mountedRef.current) return
    void restartConnection()
  }, [restartToken])

  const handleResize = useCallback(() => {
    const state = store.getState()
    if (!state.fitAddon || !state.terminal) return
    try {
      state.fitAddon.fit()
      if (state.ws?.readyState === WebSocket.OPEN) {
        const { cols, rows } = state.terminal
        state.ws.send(encodeResize(cols, rows))
      }
    } catch {
      // fit() can throw if not visible
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { terminal, fitAddon } = getOrCreateTerminal()

    if (mountedRef.current) return
    mountedRef.current = true

    // Re-mount: reattach existing DOM element instead of calling open() again
    const state = store.getState()
    if (state.initialized && terminal.element) {
      if (terminal.element.parentElement !== container) {
        container.appendChild(terminal.element)
      }
      // Theme may have changed while terminal was hidden — sync now
      terminal.options.theme = getTerminalTheme()
    } else {
      terminal.open(container)
      store.getState().set({ initialized: true })

      // Load WebGL addon after terminal is opened (needs a canvas context)
      tryLoadWebgl(terminal)
    }

    // Delay fit to ensure container is laid out
    requestAnimationFrame(() => {
      fitAddon.fit()
      void initConnection(terminal, fitAddon)
    })

    // Terminal input -> WS binary. The mobile helper bar's sticky Ctrl
    // modifier (ctrlMode) rewrites the next printable keystroke into its
    // control code; a one-shot arm auto-clears after a single key.
    const inputDisposable = terminal.onData((data) => {
      const s = store.getState()
      if (s.ws?.readyState !== WebSocket.OPEN) return
      let out = data
      if (s.ctrlMode !== 'off') {
        out = applyCtrl(data)
        if (s.ctrlMode === 'once') s.set({ ctrlMode: 'off' })
      }
      s.ws.send(encodeInput(out))
    })

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => handleResize())
    resizeObserver.observe(container)

    // Observe theme changes via MutationObserver on <html> class list
    const themeObserver = new MutationObserver(() => {
      const t = store.getState().terminal
      if (t) {
        t.options.theme = getTerminalTheme()
      }
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      mountedRef.current = false
      inputDisposable.dispose()
      resizeObserver.disconnect()
      themeObserver.disconnect()
      // Do NOT dispose terminal or close WS — they persist across mounts
    }
  }, [handleResize])

  return <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }} />
}

/** Explicitly kill the terminal session and clean up all resources */
export function disposeTerminal(): void {
  wsRetryCount = 0
  const state = store.getState()
  store.getState().set({ disposed: true, connecting: null })
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
  }
  if (state.ws) {
    state.ws.close()
  }
  if (state.sessionId) {
    deleteSession(state.sessionId)
  }
  if (state.terminal) {
    state.terminal.dispose()
  }
  store.getState().reset()
}
