import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { create } from 'zustand'

/**
 * Mobile terminal helper bar: the sticky Ctrl modifier.
 *  - `off`  — no modifier armed
 *  - `once` — one-shot: applied to the next typed key, then auto-clears
 *  - `lock` — locked on until the user taps Ctrl off (long-press to engage)
 */
export type CtrlMode = 'off' | 'once' | 'lock'

/**
 * Hard ceiling on parallel terminals per issue dock — well under the backend
 *  MAX_SESSIONS budget (10) so other issues / the file browser still have slots.
 */
export const MAX_TERMINAL_TABS = 3

/**
 * One live terminal tab: its xterm instance, fit addon, PTY session id, and the
 * WebSocket plus reconnect bookkeeping. Tabs are kept mounted in parallel (only
 * the active one is rendered into the DOM); switching tabs is instant — no
 * reconnect. Disposed in bulk when the dock host unmounts (BUG-004 contract).
 */
export interface TerminalTab {
  /** Stable client-side id for the tab (not the PTY session id). */
  id: string
  terminal: Terminal | null
  fitAddon: FitAddon | null
  /** Backend PTY session id (UUID); null until the session is created. */
  sessionId: string | null
  ws: WebSocket | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  connecting: Promise<void> | null
  /** xterm has been .open()'d into a DOM element at least once. */
  initialized: boolean
  /** Working directory the PTY should start in (issue worktree). */
  cwd: string | null
  /** Number of WS reconnect attempts since the last successful data frame. */
  retryCount: number
  /** Set when the server signalled a permanently dead PTY — stop retrying. */
  dead: boolean
}

interface TerminalSessionStore {
  /** Ordered tab ids (left-to-right in the session strip). */
  order: string[]
  /** All tabs by id. */
  tabs: Record<string, TerminalTab>
  /** Currently-rendered tab id. */
  activeId: string | null
  /** True once a dock host has armed disposal; blocks late reconnects. */
  disposed: boolean
  /** Sticky Ctrl modifier for the mobile terminal helper key bar. */
  ctrlMode: CtrlMode
  /** Persisted font size (px), separate per form factor. */
  desktopFontSize: number
  mobileFontSize: number
  set: (partial: Partial<Omit<TerminalSessionStore, 'set' | 'reset'>>) => void
  /** Replace a single tab (merging the patch). No-op if the tab is gone. */
  patchTab: (id: string, patch: Partial<TerminalTab>) => void
  reset: () => void
}

const FONT_LS_KEY = 'bkd:terminal:font'
const MIN_FONT = 6
const MAX_FONT = 28
const DEFAULT_DESKTOP_FONT = 14
const DEFAULT_MOBILE_FONT = 13

export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DESKTOP_FONT
  return Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(n)))
}

function loadFontSizes(): { desktopFontSize: number, mobileFontSize: number } {
  const fallback = { desktopFontSize: DEFAULT_DESKTOP_FONT, mobileFontSize: DEFAULT_MOBILE_FONT }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(FONT_LS_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<typeof fallback>
    return {
      desktopFontSize: clampFontSize(parsed.desktopFontSize ?? fallback.desktopFontSize),
      mobileFontSize: clampFontSize(parsed.mobileFontSize ?? fallback.mobileFontSize),
    }
  } catch {
    return fallback
  }
}

export function persistFontSizes(desktopFontSize: number, mobileFontSize: number): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FONT_LS_KEY, JSON.stringify({ desktopFontSize, mobileFontSize }))
  } catch {
    /* quota / disabled — ignore */
  }
}

const fonts = loadFontSizes()

const initialState = {
  order: [] as string[],
  tabs: {} as Record<string, TerminalTab>,
  activeId: null as string | null,
  disposed: false,
  ctrlMode: 'off' as CtrlMode,
  desktopFontSize: fonts.desktopFontSize,
  mobileFontSize: fonts.mobileFontSize,
}

export const useTerminalSessionStore = create<TerminalSessionStore>((set, get) => ({
  ...initialState,
  set: partial => set(partial),
  patchTab: (id, patch) => {
    const tabs = get().tabs
    const existing = tabs[id]
    if (!existing) return
    set({ tabs: { ...tabs, [id]: { ...existing, ...patch } } })
  },
  reset: () => set({ ...initialState, desktopFontSize: get().desktopFontSize, mobileFontSize: get().mobileFontSize }),
}))
