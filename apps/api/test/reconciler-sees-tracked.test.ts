import { describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { getEngine } from '@/engines/issue/engine-ref'
import { reconcileStaleWorkingIssues } from '@/engines/reconciler'
import { createTestProject } from './helpers'
import './setup'

describe('reconciler respects tracked processes (no two-engine split)', () => {
  it('does NOT move a working issue that has a tracked active process', async () => {
    const projectId = await createTestProject('ReconTracked')

    // Create an issue directly in the DB set to working + running (the state
    // produced once executeIssue has spawned a process).
    const [issue] = await db
      .insert(issuesTable)
      .values({
        projectId,
        statusId: 'working',
        sessionStatus: 'running',
        issueNumber: 1,
        title: 'Tracked working issue',
      })
      .returning()
    const issueId = issue.id

    // Register a fake active process in the SAME engine the reconciler reads
    // (getEngine()). This is the whole point: if the runner and reconciler
    // shared two different engines, the reconciler's PM would be empty.
    const engine = getEngine()
    engine.__registerFakeActiveForTest(issueId)
    expect(engine.hasActiveProcessForIssue(issueId)).toBe(true)

    const moved = await reconcileStaleWorkingIssues()

    // The reconciler reads getEngine().hasActiveProcessForIssue → sees the
    // tracked process → leaves the issue alone.
    const row = db
      .select()
      .from(issuesTable)
      .where(eq(issuesTable.id, issueId))
      .get()

    expect(row?.statusId).toBe('working') // NOT moved to review
    expect(moved).toBe(0)
  })
})
