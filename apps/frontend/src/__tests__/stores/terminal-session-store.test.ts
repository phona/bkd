import { beforeEach, describe, expect, it } from 'vitest'
import { clampFontSize, MAX_TERMINAL_TABS, persistFontSizes, useTerminalSessionStore } from '@/stores/terminal-session-store'
import type { TerminalTab } from '@/stores/terminal-session-store'

function makeTab(id: string): TerminalTab {
  return {
    id,
    terminal: null,
    fitAddon: null,
    sessionId: null,
    ws: null,
    reconnectTimer: null,
    connecting: null,
    initialized: false,
    cwd: null,
    retryCount: 0,
    dead: false,
  }
}

beforeEach(() => {
  useTerminalSessionStore.getState().reset()
  localStorage.clear()
})

describe('clampFontSize', () => {
  it('clamps to the 6–28px range', () => {
    expect(clampFontSize(2)).toBe(6)
    expect(clampFontSize(99)).toBe(28)
    expect(clampFontSize(14)).toBe(14)
  })

  it('rounds fractional sizes', () => {
    expect(clampFontSize(14.4)).toBe(14)
    expect(clampFontSize(14.6)).toBe(15)
  })

  it('falls back to a sane default for NaN', () => {
    expect(clampFontSize(Number.NaN)).toBe(14)
  })
})

describe('font persistence', () => {
  it('round-trips desktop + mobile sizes through localStorage', () => {
    persistFontSizes(20, 11)
    const raw = localStorage.getItem('bkd:terminal:font')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.desktopFontSize).toBe(20)
    expect(parsed.mobileFontSize).toBe(11)
  })
})

describe('terminal session store — tab bookkeeping', () => {
  it('patchTab merges into an existing tab and ignores unknown ids', () => {
    const tab = makeTab('a')
    useTerminalSessionStore.getState().set({ tabs: { a: tab }, order: ['a'], activeId: 'a' })
    useTerminalSessionStore.getState().patchTab('a', { retryCount: 3, sessionId: 'pty-1' })
    expect(useTerminalSessionStore.getState().tabs.a!.retryCount).toBe(3)
    expect(useTerminalSessionStore.getState().tabs.a!.sessionId).toBe('pty-1')

    // Unknown id is a no-op (no throw, no new key).
    useTerminalSessionStore.getState().patchTab('missing', { retryCount: 9 })
    expect(useTerminalSessionStore.getState().tabs.missing).toBeUndefined()
  })

  it('keeps the tab budget below the backend MAX_SESSIONS budget', () => {
    expect(MAX_TERMINAL_TABS).toBeLessThan(10)
    expect(MAX_TERMINAL_TABS).toBeGreaterThanOrEqual(1)
  })

  it('reset preserves persisted font sizes but clears tabs', () => {
    useTerminalSessionStore.getState().set({
      tabs: { a: makeTab('a') },
      order: ['a'],
      activeId: 'a',
      desktopFontSize: 22,
      mobileFontSize: 9,
    })
    useTerminalSessionStore.getState().reset()
    const s = useTerminalSessionStore.getState()
    expect(s.order).toEqual([])
    expect(s.tabs).toEqual({})
    expect(s.activeId).toBeNull()
    // Font sizes survive disposal so the user's zoom sticks across issues.
    expect(s.desktopFontSize).toBe(22)
    expect(s.mobileFontSize).toBe(9)
  })
})
