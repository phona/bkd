import { describe, expect, it } from 'bun:test'
import { setAppSetting } from '@/db/helpers'
import { getEngine } from '@/engines/issue'
import { stopPeriodicReconciliation } from '@/engines/reconciler'
import { initEngineLifecycle } from '@/launcher-init'

const issueEngine = getEngine()

const KEY = 'engine:maxConcurrentExecutions'

describe('max-concurrent restore on app startup', () => {
  it('initMaxConcurrent applies the saved setting to the engine', async () => {
    await setAppSetting(KEY, '9')
    await issueEngine.initMaxConcurrent()
    expect(issueEngine.getMaxConcurrent()).toBe(9)
  })

  it('initEngineLifecycle() restores the saved max-concurrent onto the engine that runs issues', async () => {
    await setAppSetting(KEY, '11')
    // The bundle's createApp() is now a pure route builder; the max-concurrent
    // restore lives in the core's initEngineLifecycle (run once by createCore).
    const stops = initEngineLifecycle()
    try {
      // initMaxConcurrent is fire-and-forget inside initEngineLifecycle; give it a tick.
      await Bun.sleep(50)
      expect(issueEngine.getMaxConcurrent()).toBe(11)
    } finally {
      stops.stopCron()
      stops.stopSettledReconciliation()
      stops.stopChangesSummaryWatcher()
      stops.stopDeliveryCleanup()
      stops.stopCockpitDigestBridge()
      stopPeriodicReconciliation()
    }
  })
})
