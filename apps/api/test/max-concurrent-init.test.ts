import { describe, expect, it } from 'bun:test'
import { setAppSetting } from '@/db/helpers'
import { getEngine } from '@/engines/issue'

const issueEngine = getEngine()

const KEY = 'engine:maxConcurrentExecutions'

describe('max-concurrent restore on app startup', () => {
  it('initMaxConcurrent applies the saved setting to the engine', async () => {
    await setAppSetting(KEY, '9')
    await issueEngine.initMaxConcurrent()
    expect(issueEngine.getMaxConcurrent()).toBe(9)
  })

  it('createApp() restores the saved max-concurrent onto the engine that runs issues', async () => {
    await setAppSetting(KEY, '11')
    const { createApp } = await import('@/app')
    createApp()
    // initMaxConcurrent is fire-and-forget inside createApp; give it a tick.
    await Bun.sleep(50)
    expect(issueEngine.getMaxConcurrent()).toBe(11)
  })
})
