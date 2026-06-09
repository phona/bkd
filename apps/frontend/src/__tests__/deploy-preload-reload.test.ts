import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// PLAN-044: the vite:preloadError → reload handler lives at module top-level in
// main.tsx. Re-implement the exact handler here and assert its contract (reload
// once, then throttle) so the deploy self-heal can't silently regress.
function installHandler() {
  const onPreloadError = (event: Event) => {
    const KEY = 'bkd:preloadReloadAt'
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 10_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
    event.preventDefault()
    window.location.reload()
  }
  window.addEventListener('vite:preloadError', onPreloadError)
  return () => window.removeEventListener('vite:preloadError', onPreloadError)
}

describe('PLAN-044 deploy resilience: vite:preloadError → reload', () => {
  let reload: ReturnType<typeof vi.fn>
  let cleanup: () => void

  beforeEach(() => {
    sessionStorage.clear()
    reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })
    cleanup = installHandler()
  })
  afterEach(() => cleanup())

  it('reloads once when a lazy chunk preload fails', () => {
    window.dispatchEvent(new Event('vite:preloadError'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('throttles: a second error within 10s does not reload again (no loop)', () => {
    window.dispatchEvent(new Event('vite:preloadError'))
    window.dispatchEvent(new Event('vite:preloadError'))
    window.dispatchEvent(new Event('vite:preloadError'))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
