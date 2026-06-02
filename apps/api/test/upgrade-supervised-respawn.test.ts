import { afterEach, describe, expect, it } from 'bun:test'
import { shouldSelfRespawnOnUpgrade } from '@/upgrade/apply'

const original = process.env.BKD_SUPERVISED

afterEach(() => {
  if (original === undefined) delete process.env.BKD_SUPERVISED
  else process.env.BKD_SUPERVISED = original
})

describe('shouldSelfRespawnOnUpgrade', () => {
  it('self-forks a replacement when NOT supervised (default)', () => {
    delete process.env.BKD_SUPERVISED
    expect(shouldSelfRespawnOnUpgrade()).toBe(true)
  })

  it('does NOT self-fork under a supervisor (BKD_SUPERVISED=1) — supervisor relaunches', () => {
    process.env.BKD_SUPERVISED = '1'
    expect(shouldSelfRespawnOnUpgrade()).toBe(false)
  })

  it('only the exact value "1" disables self-respawn', () => {
    process.env.BKD_SUPERVISED = '0'
    expect(shouldSelfRespawnOnUpgrade()).toBe(true)
    process.env.BKD_SUPERVISED = 'true'
    expect(shouldSelfRespawnOnUpgrade()).toBe(true)
  })
})
