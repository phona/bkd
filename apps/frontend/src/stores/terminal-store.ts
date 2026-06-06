import { create } from 'zustand'
import { attachResizeClamp } from '@/lib/store-resize'

const MIN_WIDTH = 320
const DEFAULT_WIDTH_RATIO = 0.4
const MAX_WIDTH_RATIO = 0.65

function getViewportWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth
}

function clampWidth(w: number): number {
  const min = MIN_WIDTH
  const max = getViewportWidth() * MAX_WIDTH_RATIO
  return Math.max(min, Math.min(w, max))
}

interface TerminalStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  width: number
  /**
   * When set, the next terminal connection must start a FRESH session in this
   * directory (e.g. an issue's worktree). Consumed by TerminalView once the
   * session is created.
   */
  pendingCwd: string | null
  /** Bumped by openInDir to force an already-open terminal to recreate. */
  restartToken: number
  open: () => void
  openFullscreen: () => void
  /** Open the terminal in a specific directory, starting a fresh session. */
  openInDir: (cwd: string, fullscreen?: boolean) => void
  clearPendingCwd: () => void
  close: () => void
  toggle: () => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
}

export { MIN_WIDTH as TERMINAL_MIN_WIDTH }
export const TERMINAL_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

export const useTerminalStore = create<TerminalStore>(set => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  width: Math.round(getViewportWidth() * DEFAULT_WIDTH_RATIO),
  pendingCwd: null,
  restartToken: 0,

  open: () => set({ isOpen: true, isMinimized: false }),
  openFullscreen: () => set({ isOpen: true, isMinimized: false, isFullscreen: true }),
  openInDir: (cwd, fullscreen = false) =>
    set(s => ({
      isOpen: true,
      isMinimized: false,
      isFullscreen: fullscreen ? true : s.isFullscreen,
      pendingCwd: cwd,
      restartToken: s.restartToken + 1,
    })),
  clearPendingCwd: () => set({ pendingCwd: null }),
  close: () => set({ isOpen: false }),
  toggle: () =>
    set((s) => {
      if (s.isMinimized) return { isOpen: true, isMinimized: false }
      return { isOpen: !s.isOpen }
    }),
  minimize: () => set({ isOpen: false, isMinimized: true, isFullscreen: false }),
  restore: () => set({ isOpen: true, isMinimized: false }),
  toggleFullscreen: () => set(s => ({ isFullscreen: !s.isFullscreen })),
  setWidth: w => set({ width: clampWidth(w) }),
}))

// Re-clamp width on window resize (HMR-safe via import.meta.hot.dispose)
attachResizeClamp(useTerminalStore.getState, clampWidth, import.meta.hot)

// Per-field selectors to avoid full re-renders
export const useTerminalOpen = () => useTerminalStore(s => s.isOpen)
export const useTerminalMinimized = () => useTerminalStore(s => s.isMinimized)
export const useTerminalFullscreen = () => useTerminalStore(s => s.isFullscreen)
export const useTerminalWidth = () => useTerminalStore(s => s.width)
