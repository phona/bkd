import { describe, expect, it } from 'bun:test'
import { getBus, setBus } from '@/events/bus-ref'

describe('event bus accessor', () => {
  it('returns a default bus, and setBus overrides it', () => {
    const first = getBus()
    expect(typeof first.emit).toBe('function') // it is an AppEventBus
    expect(typeof first.on).toBe('function')
    const stub = { emit() {}, on() {} } as any
    setBus(stub)
    expect(getBus()).toBe(stub)
    setBus(first) // restore for other tests in the same process
  })
})
