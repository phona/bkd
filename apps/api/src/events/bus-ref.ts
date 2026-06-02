import type { AppEventBus } from './event-bus'

let current: AppEventBus | undefined

/** Inject the process-wide event bus (called once at boot by the core). */
export function setBus(bus: AppEventBus): void {
  current = bus
}

/** The single event bus for this process. Lazily creates a default for dev/tests. */
export function getBus(): AppEventBus {
  if (!current) {
    const { AppEventBus } = require('./event-bus') as typeof import('./event-bus')
    current = new AppEventBus()
  }
  return current
}
