import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getToken } from '@/lib/auth'
import type { TerminalTab } from '@/stores/terminal-session-store'
import {
  clampFontSize,
  MAX_TERMINAL_TABS,
  persistFontSizes,
  useTerminalSessionStore,
} from '@/stores/terminal-session-store'
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

// --- Layout / reconnect constants ---

const MOBILE_BREAKPOINT_PX = 768
const MIN_FONT_SIZE = 6
const MAX_FONT_SIZE = 28
// Fast-start reconnect ladder (AoE #1455): 200ms…10s instead of a fixed 2s×3.
const RETRY_DELAYS_MS = [200, 400, 800, 1500, 3000, 6000, 10000] as const
const MAX_RETRIES = RETRY_DELAYS_MS.length
// Native xterm scrollback so "Back to live" works without tmux (item D).
const SCROLLBACK_LINES = 5000

export function retryDelayMs(attempt: number): number {
  const idx = Math.max(1, Math.min(RETRY_DELAYS_MS.length, attempt)) - 1
  return RETRY_DELAYS_MS[idx]!
}

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX
}

function activeFontSize(): number {
  const s = useTerminalSessionStore.getState()
  return isMobileViewport() ? s.mobileFontSize : s.desktopFontSize
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

function encodeResize(cols: number, rows: number): ArrayBuffer {
  const buf = new ArrayBuffer(5)
  const view = new DataView(buf)
  view.setUint8(0, 0x01)
  view.setUint16(1, cols, false)
  view.setUint16(3, rows, false)
  return buf
}

// --- Active-tab helpers (consumed by TerminalKeyBar / session strip) ---

function activeTab(): TerminalTab | null {
  const s = useTerminalSessionStore.getState()
  return s.activeId ? (s.tabs[s.activeId] ?? null) : null
}

/**
 * Send a raw input sequence to the ACTIVE terminal's PTY (mobile helper keys:
 * Esc / Tab / arrows / symbols / paste). No-op when the socket is not open.
 */
export function sendTerminalInput(data: string): void {
  const tab = activeTab()
  if (tab?.ws?.readyState === WebSocket.OPEN) {
    tab.ws.send(encodeInput(data))
  }
}

/** Focus the active terminal's xterm instance (used after helper-key taps). */
export function focusActiveTerminal(): void {
  activeTab()?.terminal?.focus()
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

function deleteSession(sessionId: string): void {
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

// --- xterm instance lifecycle ---

const store = useTerminalSessionStore

function createTerminal(): { terminal: Terminal, fitAddon: FitAddon } {
  const fitAddon = new FitAddon()
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: activeFontSize(),
    fontFamily:
      'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
    theme: getTerminalTheme(),
    allowProposedApi: true,
    scrollback: SCROLLBACK_LINES,
  })
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())
  terminal.loadAddon(new ImageAddon())
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

// --- Per-tab connection ---

function connectWs(tabId: string): void {
  const tab = store.getState().tabs[tabId]
  if (!tab || store.getState().disposed) return
  if (!tab.sessionId || !tab.terminal || !tab.fitAddon) return
  if (tab.ws && (tab.ws.readyState === WebSocket.OPEN || tab.ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  const terminal = tab.terminal
  const fitAddon = tab.fitAddon
  const sessionId = tab.sessionId
  const ws = new WebSocket(wsUrl(sessionId))
  ws.binaryType = 'arraybuffer'
  store.getState().patchTab(tabId, { ws })

  let receivedData = false

  ws.addEventListener('open', () => {
    try {
      fitAddon.fit()
    } catch {
      /* not visible yet */
    }
    const { cols, rows } = terminal
    if (ws.readyState === WebSocket.OPEN) ws.send(encodeResize(cols, rows))
  })

  ws.addEventListener('message', (evt) => {
    if (!receivedData) {
      receivedData = true
      store.getState().patchTab(tabId, { retryCount: 0 })
    }
    if (evt.data instanceof ArrayBuffer) {
      terminal.write(new Uint8Array(evt.data))
    }
  })

  ws.addEventListener('close', (evt) => {
    store.getState().patchTab(tabId, { ws: null })
    const cur = store.getState().tabs[tabId]
    if (!cur || store.getState().disposed) return

    // Replaced by another tab/connection — stop reconnecting
    if (evt.code === 4000) {
      store.getState().patchTab(tabId, { sessionId: null, dead: true })
      terminal.writeln('\r\n\x1B[90m[session taken over by another tab]\x1B[0m')
      return
    }

    // Server-signalled dead PTY (PTY exited / rejected) — recreate a fresh
    // session in the same cwd. code 1008 = rejected upgrade, 1000 + "PTY exited".
    if (evt.reason === 'PTY exited' || evt.code === 1008) {
      store.getState().patchTab(tabId, { sessionId: null })
      terminal.writeln('\r\n\x1B[90m[session ended, reconnecting...]\x1B[0m')
      scheduleReconnect(tabId, retryDelayMs(1), true)
      return
    }

    // WS dropped but PTY may still be alive — reconnect with fast backoff.
    const retryCount = cur.retryCount + 1
    if (retryCount > MAX_RETRIES) {
      // Exhausted same-session retries — start a fresh session.
      store.getState().patchTab(tabId, { sessionId: null, retryCount: 0 })
      scheduleReconnect(tabId, retryDelayMs(1), true)
      return
    }
    store.getState().patchTab(tabId, { retryCount })
    scheduleReconnect(tabId, retryDelayMs(retryCount), false)
  })

  ws.addEventListener('error', () => {
    try {
      ws.close()
    } catch {
      /* already closed */
    }
  })
}

/**
 * Schedule a reconnect for a tab. `fresh` recreates the PTY session;
 * otherwise it redials the existing one.
 */
function scheduleReconnect(tabId: string, delayMs: number, fresh: boolean): void {
  if (store.getState().disposed) return
  const timer = setTimeout(() => {
    store.getState().patchTab(tabId, { reconnectTimer: null })
    if (store.getState().disposed) return
    if (fresh) {
      void initConnection(tabId)
    } else {
      const t = store.getState().tabs[tabId]
      if (t?.sessionId) connectWs(tabId)
      else void initConnection(tabId)
    }
  }, delayMs)
  store.getState().patchTab(tabId, { reconnectTimer: timer })
}

/** Create a PTY session for a tab (if needed) and connect its WS. */
async function initConnection(tabId: string): Promise<void> {
  const tab = store.getState().tabs[tabId]
  if (!tab || store.getState().disposed) return

  if (
    tab.sessionId &&
    tab.ws &&
    (tab.ws.readyState === WebSocket.OPEN || tab.ws.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  if (tab.connecting) {
    await tab.connecting
    return
  }

  const connectingPromise = (async () => {
    try {
      const sessionId = await createSession(tab.cwd)
      // The tab may have been torn down (issue change / tab close) or the whole
      // dock disposed while the create request was in flight — don't leak an
      // orphan PTY in that case; kill it immediately rather than waiting for the
      // backend's unattached reaper.
      if (store.getState().disposed || !store.getState().tabs[tabId]) {
        deleteSession(sessionId)
        return
      }
      store.getState().patchTab(tabId, { sessionId })
      connectWs(tabId)
    } catch {
      scheduleReconnect(tabId, retryDelayMs(1), true)
    } finally {
      store.getState().patchTab(tabId, { connecting: null })
    }
  })()

  store.getState().patchTab(tabId, { connecting: connectingPromise })
  await connectingPromise
}

let tabCounter = 0
function nextTabId(): string {
  tabCounter += 1
  return `term-${Date.now()}-${tabCounter}`
}

/**
 * Create a new terminal tab in the given cwd, mount its xterm into the offscreen
 * pool (open happens on first render), and start connecting. Returns the tab id,
 * or null when the per-issue tab budget is exhausted.
 */
export function createTerminalTab(cwd: string | null): string | null {
  const s = store.getState()
  if (s.order.length >= MAX_TERMINAL_TABS) return null
  const id = nextTabId()
  const { terminal, fitAddon } = createTerminal()
  const tab: TerminalTab = {
    id,
    terminal,
    fitAddon,
    sessionId: null,
    ws: null,
    reconnectTimer: null,
    connecting: null,
    initialized: false,
    cwd,
    retryCount: 0,
    dead: false,
  }
  store.getState().set({
    tabs: { ...s.tabs, [id]: tab },
    order: [...s.order, id],
    activeId: id,
    disposed: false,
  })
  void initConnection(id)
  return id
}

/** Switch the rendered tab (instant — no reconnect). */
export function switchTerminalTab(id: string): void {
  if (store.getState().tabs[id]) store.getState().set({ activeId: id })
}

function teardownTab(tab: TerminalTab): void {
  if (tab.reconnectTimer) clearTimeout(tab.reconnectTimer)
  if (tab.ws) {
    try {
      tab.ws.close()
    } catch {
      /* already closed */
    }
  }
  if (tab.sessionId) deleteSession(tab.sessionId)
  if (tab.terminal) {
    try {
      tab.terminal.dispose()
    } catch {
      /* already disposed */
    }
  }
}

/** Close a single tab (kills its PTY). Keeps the rest alive. */
export function closeTerminalTab(id: string): void {
  const s = store.getState()
  const tab = s.tabs[id]
  if (!tab) return
  teardownTab(tab)
  const order = s.order.filter(x => x !== id)
  const { [id]: _removed, ...rest } = s.tabs
  let activeId = s.activeId
  if (activeId === id) activeId = order.at(-1) ?? null
  store.getState().set({ tabs: rest, order, activeId })
}

/**
 * Explicitly kill ALL terminal sessions for this issue and clean up resources.
 * Called by DockTerminal on unmount — the BUG-004 guarantee that hidden ≠ leaked
 * but every PTY is torn down when the dock host genuinely goes away.
 */
export function disposeTerminal(): void {
  const s = store.getState()
  store.getState().set({ disposed: true })
  for (const id of s.order) {
    const tab = s.tabs[id]
    if (tab) teardownTab(tab)
  }
  store.getState().reset()
}

// --- Font sizing (pinch-zoom + persistence, item B) ---

function applyFontSizeToAll(size: number): void {
  const clamped = clampFontSize(size)
  const s = store.getState()
  if (isMobileViewport()) store.getState().set({ mobileFontSize: clamped })
  else store.getState().set({ desktopFontSize: clamped })
  persistFontSizes(store.getState().desktopFontSize, store.getState().mobileFontSize)
  for (const id of s.order) {
    const tab = s.tabs[id]
    if (tab?.terminal) {
      tab.terminal.options.fontSize = clamped
      try {
        tab.fitAddon?.fit()
      } catch {
        /* not visible */
      }
    }
  }
}

/** +/- font controls for desktop. */
export function nudgeTerminalFont(delta: number): void {
  applyFontSizeToAll(activeFontSize() + delta)
}

// --- View component ---

/**
 * Renders the active terminal tab and keeps the others mounted (offscreen) so
 * switching is instant. The first tab is created lazily on mount. Pinch-zoom,
 * scrollback "Back to live", and reconnect are all wired here.
 */
export function TerminalView({ className }: { className?: string }) {
  const poolRef = useRef<HTMLDivElement>(null)
  const order = useTerminalSessionStore(s => s.order)
  const activeId = useTerminalSessionStore(s => s.activeId)
  const [atBottom, setAtBottom] = useState(true)
  const bootstrappedRef = useRef(false)

  // Bootstrap the first tab once (the dock host arms cwd before mounting us).
  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true
    if (store.getState().order.length === 0) {
      const cwd = pendingInitialCwdRef.current
      createTerminalTab(cwd)
    }
  }, [])

  // Mount each tab's DOM element into the offscreen pool exactly once, then
  // move only the ACTIVE element into the visible container.
  useEffect(() => {
    const pool = poolRef.current
    if (!pool) return
    const s = store.getState()
    for (const id of s.order) {
      const tab = s.tabs[id]
      if (!tab?.terminal || !tab.fitAddon) continue
      if (!tab.initialized) {
        // Each xterm needs its own host element.
        const host = document.createElement('div')
        host.style.width = '100%'
        host.style.height = '100%'
        host.dataset.termTab = id
        pool.appendChild(host)
        tab.terminal.open(host)
        store.getState().patchTab(id, { initialized: true })
        tryLoadWebgl(tab.terminal)
        wireTerminal(id, tab.terminal)
        requestAnimationFrame(() => {
          try {
            tab.fitAddon?.fit()
          } catch {
            /* not visible */
          }
        })
      }
    }
  }, [order])

  // Theme + visibility: render only the active tab's host into the container,
  // park the others in the offscreen pool.
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = containerRef.current
    const pool = poolRef.current
    if (!container || !pool) return
    const s = store.getState()
    for (const id of s.order) {
      const tab = s.tabs[id]
      const el = tab?.terminal?.element?.parentElement as HTMLElement | undefined
      if (!el) continue
      tab!.terminal!.options.theme = getTerminalTheme()
      if (id === s.activeId) {
        if (el.parentElement !== container) container.appendChild(el)
      } else if (el.parentElement !== pool) {
        pool.appendChild(el)
      }
    }
    // Fit + focus the newly-active tab.
    const active = s.activeId ? s.tabs[s.activeId] : null
    if (active?.fitAddon) {
      requestAnimationFrame(() => {
        try {
          active.fitAddon!.fit()
          if (active.ws?.readyState === WebSocket.OPEN) {
            const { cols, rows } = active.terminal!
            active.ws.send(encodeResize(cols, rows))
          }
          active.terminal?.focus()
        } catch {
          /* not visible */
        }
      })
    }
  }, [activeId, order])

  const handleResize = useCallback(() => {
    const tab = activeTab()
    if (!tab?.fitAddon || !tab.terminal) return
    try {
      tab.fitAddon.fit()
      // Re-apply the form-factor font on resize crossing the breakpoint.
      const want = activeFontSize()
      if (tab.terminal.options.fontSize !== want) {
        tab.terminal.options.fontSize = want
        tab.fitAddon.fit()
      }
      if (tab.ws?.readyState === WebSocket.OPEN) {
        const { cols, rows } = tab.terminal
        tab.ws.send(encodeResize(cols, rows))
      }
    } catch {
      /* not visible */
    }
  }, [])

  // Container resize + theme observers.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => handleResize())
    ro.observe(container)
    const themeObserver = new MutationObserver(() => {
      const s = store.getState()
      for (const id of s.order) {
        const t = s.tabs[id]?.terminal
        if (t) t.options.theme = getTerminalTheme()
      }
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const onWinResize = () => handleResize()
    window.addEventListener('resize', onWinResize)
    return () => {
      ro.disconnect()
      themeObserver.disconnect()
      window.removeEventListener('resize', onWinResize)
    }
  }, [handleResize])

  // Track scroll position of the active tab for the "Back to live" pill.
  useEffect(() => {
    const tab = activeTab()
    const term = tab?.terminal
    if (!term) return
    const update = () => {
      const buf = term.buffer.active
      const atEnd = buf.viewportY >= buf.baseY
      setAtBottom(atEnd)
    }
    update()
    const disp = term.onScroll(() => update())
    return () => disp.dispose()
  }, [activeId, order])

  const backToLive = useCallback(() => {
    const term = activeTab()?.terminal
    term?.scrollToBottom()
    setAtBottom(true)
    term?.focus()
  }, [])

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Offscreen pool keeps non-active tabs mounted (and warm). */}
      <div ref={poolRef} aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }} />
      {!atBottom ? (
        <button
          type="button"
          onClick={backToLive}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-accent-brand px-3 py-1 text-[12px] font-medium text-white shadow-lg active:scale-95"
          data-testid="terminal-back-to-live"
        >
          ↓
          {' '}
          {backToLiveLabel()}
        </button>
      ) : null}
    </div>
  )
}

// Label is resolved lazily so this module stays free of the i18n import cycle.
let _backToLiveLabel = 'Back to live'
export function setBackToLiveLabel(label: string): void {
  _backToLiveLabel = label
}
function backToLiveLabel(): string {
  return _backToLiveLabel
}

// The dock arms the worktree cwd before TerminalView mounts; stash it here so
// the bootstrap effect can read it for the first tab.
const pendingInitialCwdRef = { current: null as string | null }
export function setPendingInitialCwd(cwd: string | null): void {
  pendingInitialCwdRef.current = cwd
}

// --- Per-terminal input + gesture wiring ---

function wireTerminal(tabId: string, terminal: Terminal): void {
  // Terminal input -> WS binary, honoring the sticky Ctrl modifier.
  terminal.onData((data) => {
    const tab = store.getState().tabs[tabId]
    if (tab?.ws?.readyState !== WebSocket.OPEN) return
    const s = store.getState()
    let out = data
    if (s.ctrlMode !== 'off') {
      out = applyCtrl(data)
      if (s.ctrlMode === 'once') store.getState().set({ ctrlMode: 'off' })
    }
    tab.ws.send(encodeInput(out))
  })

  const el = terminal.element
  if (!el) return

  // Pinch-zoom (mobile, item B): two-finger pinch adjusts font size live.
  let pinchStartDist = 0
  let pinchStartSize = 0
  const dist = (e: TouchEvent): number => {
    const a = e.touches[0]
    const b = e.touches[1]
    if (!a || !b) return 0
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }
  el.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStartDist = dist(e)
      pinchStartSize = typeof terminal.options.fontSize === 'number' ? terminal.options.fontSize : activeFontSize()
    }
  }, { passive: true })
  el.addEventListener('touchmove', (e: TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      e.preventDefault()
      const ratio = dist(e) / pinchStartDist
      const next = clampFontSize(pinchStartSize * ratio)
      const cur = typeof terminal.options.fontSize === 'number' ? terminal.options.fontSize : 0
      if (next !== cur && next >= MIN_FONT_SIZE && next <= MAX_FONT_SIZE) {
        applyFontSizeToAll(next)
      }
    }
  }, { passive: false })
}
