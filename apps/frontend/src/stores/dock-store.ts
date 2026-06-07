import { create } from 'zustand'
import { attachResizeClamp } from '@/lib/store-resize'

// Single source of truth for the issue-detail dock (PLAN-036):
//  - desktop: a persistent right rail (tabs terminal/files/diff, resizable,
//    collapsible); open/collapsed/width/tab are remembered across sessions.
//  - mobile: which panel is summoned full-screen (not persisted — transient).

export type DockTab = 'terminal' | 'files' | 'diff'

const MIN_WIDTH = 320
const MAX_WIDTH_RATIO = 0.6
const DEFAULT_WIDTH = 480

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth
}
function clampWidth(w: number): number {
  return Math.max(MIN_WIDTH, Math.min(w, viewportWidth() * MAX_WIDTH_RATIO))
}

const LS_KEY = 'bkd:dock'

interface Persisted {
  open: boolean
  collapsed: boolean
  width: number
  tab: DockTab
}

function loadPersisted(): Persisted {
  const fallback: Persisted = { open: false, collapsed: false, width: DEFAULT_WIDTH, tab: 'diff' }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return { ...fallback, ...parsed, width: clampWidth(parsed.width ?? fallback.width) }
  } catch {
    return fallback
  }
}

interface DockStore extends Persisted {
  /** Mobile-only: which panel is shown full-screen (null = chat). Transient. */
  mobilePanel: DockTab | null
  setOpen: (v: boolean) => void
  toggleOpen: () => void
  setCollapsed: (v: boolean) => void
  setWidth: (w: number) => void
  setTab: (t: DockTab) => void
  /** Open the rail (uncollapsed) on a given tab — the common desktop entry. */
  openTab: (t: DockTab) => void
  openMobile: (t: DockTab) => void
  closeMobile: () => void
}

function persist(s: Persisted): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ open: s.open, collapsed: s.collapsed, width: s.width, tab: s.tab }))
  } catch {
    /* quota / disabled — ignore */
  }
}

export const useDockStore = create<DockStore>((set, get) => {
  const save = (patch: Partial<Persisted>) => {
    const next = { ...get(), ...patch }
    persist(next)
    return patch
  }
  return {
    ...loadPersisted(),
    mobilePanel: null,
    setOpen: v => set(() => save({ open: v })),
    toggleOpen: () => set(() => save({ open: !get().open })),
    setCollapsed: v => set(() => save({ collapsed: v })),
    setWidth: w => set(() => save({ width: clampWidth(w) })),
    setTab: t => set(() => save({ tab: t })),
    openTab: t => set(() => save({ open: true, collapsed: false, tab: t })),
    openMobile: t => set({ mobilePanel: t }),
    closeMobile: () => set({ mobilePanel: null }),
  }
})

attachResizeClamp(
  () => ({ width: useDockStore.getState().width, setWidth: useDockStore.getState().setWidth }),
  clampWidth,
  import.meta.hot,
)
