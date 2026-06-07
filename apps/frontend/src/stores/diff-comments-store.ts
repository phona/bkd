import type { DiffComment } from '@/lib/review-comment'
import { create } from 'zustand'

/**
 * Per-issue diff review comments (PLAN-035 / DIFF-001).
 *
 * The user annotates diff lines while reviewing; comments persist locally until
 * sent to the agent as a single follow-up. Kept in localStorage so a refresh /
 * tab switch mid-review doesn't lose notes. Mirrors the throttled-persist
 * pattern of the scroll-position store.
 */

const STORAGE_KEY = 'bkd-diff-comments'

interface DiffCommentsStore {
  byIssue: Record<string, DiffComment[]>
  add: (issueId: string, comment: Omit<DiffComment, 'id'>) => void
  update: (issueId: string, id: string, text: string) => void
  remove: (issueId: string, id: string) => void
  clear: (issueId: string) => void
  get: (issueId: string) => DiffComment[]
}

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function load(): Record<string, DiffComment[]> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, DiffComment[]>
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist(byIssue: Record<string, DiffComment[]>) {
  if (typeof window === 'undefined') return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(byIssue))
    } catch {
      /* quota / disabled storage — silently drop */
    }
  }, 400)
}

export const useDiffCommentsStore = create<DiffCommentsStore>((set, get) => ({
  byIssue: load(),
  add: (issueId, comment) => {
    set((state) => {
      const next = {
        ...state.byIssue,
        [issueId]: [...(state.byIssue[issueId] ?? []), { ...comment, id: newId() }],
      }
      persist(next)
      return { byIssue: next }
    })
  },
  update: (issueId, id, text) => {
    set((state) => {
      const list = state.byIssue[issueId]
      if (!list) return state
      const next = {
        ...state.byIssue,
        [issueId]: list.map(c => (c.id === id ? { ...c, text } : c)),
      }
      persist(next)
      return { byIssue: next }
    })
  },
  remove: (issueId, id) => {
    set((state) => {
      const list = state.byIssue[issueId]
      if (!list) return state
      const next = { ...state.byIssue, [issueId]: list.filter(c => c.id !== id) }
      persist(next)
      return { byIssue: next }
    })
  },
  clear: (issueId) => {
    set((state) => {
      if (!(issueId in state.byIssue)) return state
      const next = { ...state.byIssue }
      delete next[issueId]
      persist(next)
      return { byIssue: next }
    })
  },
  get: issueId => get().byIssue[issueId] ?? [],
}))
