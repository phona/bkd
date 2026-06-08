import { describe, expect, it, vi } from 'vitest'

// xterm CSS import + addons pull in browser globals; stub the heavy bits so the
// module loads under jsdom just to exercise the pure retryDelayMs schedule.
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const { retryDelayMs } = await import('@/components/terminal/TerminalView')

describe('retryDelayMs (fast-start reconnect ladder, item E)', () => {
  it('follows AoE 200ms…10s schedule', () => {
    expect(retryDelayMs(1)).toBe(200)
    expect(retryDelayMs(2)).toBe(400)
    expect(retryDelayMs(3)).toBe(800)
    expect(retryDelayMs(4)).toBe(1500)
    expect(retryDelayMs(5)).toBe(3000)
    expect(retryDelayMs(6)).toBe(6000)
    expect(retryDelayMs(7)).toBe(10000)
  })

  it('clamps out-of-range attempts to the schedule bounds', () => {
    expect(retryDelayMs(0)).toBe(200)
    expect(retryDelayMs(-5)).toBe(200)
    expect(retryDelayMs(99)).toBe(10000)
  })
})
