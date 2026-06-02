import { afterEach, describe, expect, it } from 'bun:test'
import { deleteAppSetting, setAppSetting } from '@/db/helpers'
import { MAX_CONCURRENT_EXECUTIONS } from '@/engines/issue/constants'
import { IssueEngine } from '@/engines/issue/engine'
import { MAX_CONCURRENT_KEY, readInitialMaxConcurrent } from '@/engines/issue/max-concurrent'

afterEach(async () => {
  await deleteAppSetting(MAX_CONCURRENT_KEY)
})

describe('readInitialMaxConcurrent (closes the boot window)', () => {
  it('returns the persisted value synchronously', async () => {
    await setAppSetting(MAX_CONCURRENT_KEY, '50')
    expect(readInitialMaxConcurrent()).toBe(50)
  })

  it('falls back to the compile-time default when unset', async () => {
    await deleteAppSetting(MAX_CONCURRENT_KEY)
    expect(readInitialMaxConcurrent()).toBe(MAX_CONCURRENT_EXECUTIONS)
  })

  it('falls back to the default on an invalid value', async () => {
    await setAppSetting(MAX_CONCURRENT_KEY, 'not-a-number')
    expect(readInitialMaxConcurrent()).toBe(MAX_CONCURRENT_EXECUTIONS)
  })

  it('a freshly constructed engine already reflects the DB value — no default window', async () => {
    await setAppSetting(MAX_CONCURRENT_KEY, '37')
    const engine = new IssueEngine()
    // Read immediately, with NO await for the async initMaxConcurrent() path.
    expect(engine.getMaxConcurrent()).toBe(37)
  })
})
