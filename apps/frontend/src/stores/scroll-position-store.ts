import type { ScrollAnchor } from '@/components/issue-detail/scroll-coordination'
import { create } from 'zustand'

/**
 * Per-issue scroll anchor memory.
 *
 * When the user navigates between issues we persist a SEMANTIC anchor for each
 * one and restore it on return — either "was following the latest" (land at the
 * bottom) or the messageId at the top of the viewport (resume reading). This
 * replaces the old absolute-pixel scrollTop, which drifted whenever the content
 * height changed (async Shiki/markdown rendering, new messages while away). See
 * `computeScrollAnchor` and BUG-005.
 *
 * Design choices:
 * - Stored as a flat `issueId → ScrollAnchor` map; cheap (O(1) read/write).
 * - Persisted to localStorage so it survives full reloads / tab close.
 * - Capped at 200 entries via FIFO prune so a long-tenured fork doesn't bloat
 *   the JSON blob with stale issue keys.
 * - In-memory map seeded from localStorage at module load; legacy numeric
 *   (pixel) entries from before BUG-005 are dropped on load so a stale pixel can
 *   never mis-position again — those issues just land at the latest message.
 */

const STORAGE_KEY = 'bkd-scroll-positions'
const MAX_ENTRIES = 200

interface ScrollPositionStore {
  positions: Record<string, ScrollAnchor>
  setPosition: (issueId: string, anchor: ScrollAnchor) => void
  getPosition: (issueId: string) => ScrollAnchor | undefined
  clear: (issueId: string) => void
}

function isScrollAnchor(value: unknown): value is ScrollAnchor {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as ScrollAnchor).atBottom === 'boolean'
  )
}

function loadPositions(): Record<string, ScrollAnchor> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== 'object' || !parsed) return {}
    // Drop legacy numeric (pixel) entries and any other malformed shapes so a
    // stale pre-BUG-005 pixel can never mis-position again.
    const clean: Record<string, ScrollAnchor> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isScrollAnchor(value)) clean[key] = value
    }
    return clean
  } catch {
    return {}
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(positions: Record<string, ScrollAnchor>) {
  if (typeof window === 'undefined') return
  // Throttle writes to avoid hammering localStorage on every scroll tick.
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(positions))
    } catch {
      /* quota / disabled storage — silently drop */
    }
  }, 500)
}

export const useScrollPositionStore = create<ScrollPositionStore>((set, get) => ({
  positions: loadPositions(),
  setPosition: (issueId, anchor) => {
    set((state) => {
      const next = { ...state.positions, [issueId]: anchor }
      // FIFO prune when the map gets too big — keep the most recent 200.
      const keys = Object.keys(next)
      if (keys.length > MAX_ENTRIES) {
        const drop = keys.length - MAX_ENTRIES
        for (let i = 0; i < drop; i++) {
          delete next[keys[i]]
        }
      }
      schedulePersist(next)
      return { positions: next }
    })
  },
  getPosition: (issueId) => {
    return get().positions[issueId]
  },
  clear: (issueId) => {
    set((state) => {
      if (!(issueId in state.positions)) return state
      const next = { ...state.positions }
      delete next[issueId]
      schedulePersist(next)
      return { positions: next }
    })
  },
}))
