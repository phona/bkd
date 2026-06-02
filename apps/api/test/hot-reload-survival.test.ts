import type { AppEventMap } from '@bkd/shared'
import { describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { getEngine, setEngine } from '@/engines/issue/engine-ref'
import { reconcileStaleWorkingIssues } from '@/engines/reconciler'
import { getBus, setBus } from '@/events/bus-ref'
import { createTestProject } from './helpers'
import './setup'

/**
 * Stage-3 invariant: a route hot-reload keeps the SAME persistent engine + bus
 * instances (re-injected via setEngine/setBus) and must NOT kill an in-flight
 * tracked process. The launcher's reload re-imports the route bundle but the
 * engine/bus live outside it; here we simulate the swap in-process by capturing
 * the persistent instances and re-injecting them, then asserting nothing was
 * lost. No real launcher process and no lifecycle timers are started.
 */
describe('hot-reload survival', () => {
  it('engine + bus identity survive idempotent re-injection', () => {
    const e1 = getEngine()
    setEngine(e1) // simulate reload re-injecting the SAME instance
    expect(getEngine()).toBe(e1)

    const b1 = getBus()
    setBus(b1)
    expect(getBus()).toBe(b1)
  })

  it('tracked in-flight process survives a reload and the reconciler spares it', async () => {
    const projectId = await createTestProject('HotReloadTracked')

    // Issue in the state produced once executeIssue has spawned a process.
    const [issue] = await db
      .insert(issuesTable)
      .values({
        projectId,
        statusId: 'working',
        sessionStatus: 'running',
        issueNumber: 1,
        title: 'In-flight issue',
      })
      .returning()
    const issueId = issue.id

    // Register a fake active process on the persistent engine.
    getEngine().__registerFakeActiveForTest(issueId)
    expect(getEngine().hasActiveProcessForIssue(issueId)).toBe(true)

    // Simulate the hot-reload: re-inject the SAME engine + bus instances.
    setEngine(getEngine())
    setBus(getBus())

    // The ProcessManager state lives on the engine instance, which persisted,
    // so the tracked process is still visible after the swap.
    expect(getEngine().hasActiveProcessForIssue(issueId)).toBe(true)

    // The reconciler reads getEngine().hasActiveProcessForIssue → sees the
    // tracked process → must leave the issue alone.
    await reconcileStaleWorkingIssues()

    const row = db
      .select()
      .from(issuesTable)
      .where(eq(issuesTable.id, issueId))
      .get()

    expect(row?.statusId).toBe('working') // NOT flipped to review
    expect(row?.sessionStatus).toBe('running') // NOT flipped to failed
  })

  it('bus subscriptions still deliver after a reload, and unsubscribe works', () => {
    const bus = getBus()

    let received: AppEventMap['issue-updated'] | undefined
    let calls = 0
    const unsubscribe = bus.on('issue-updated', (data) => {
      calls += 1
      received = data
    })

    // Simulate the hot-reload: re-inject the SAME bus instance.
    setBus(getBus())
    expect(getBus()).toBe(bus)

    const payload: AppEventMap['issue-updated'] = {
      issueId: 'hot-reload-issue',
      changes: { statusId: 'working' },
    }
    getBus().emit('issue-updated', payload)

    // The subscriber registered on the persistent bus survived the swap.
    expect(calls).toBe(1)
    expect(received).toEqual(payload)

    // Unsubscribe must stop further delivery.
    unsubscribe()
    getBus().emit('issue-updated', payload)
    expect(calls).toBe(1)
  })
})
