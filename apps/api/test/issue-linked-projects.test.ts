import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueProjects as issueProjectsTable, projects as projectsTable } from '@/db/schema'
import { spawnNodeSync } from '@/engines/spawn'
import {
  materializeLinkedWorktrees,
  removeWorktree,
  resolveWorktreePath,
} from '@/engines/issue/utils/worktree'
import { createTestProject, expectSuccess, get, post } from './helpers'

/**
 * PLAN-037 multi-project association tests:
 * 1. Creating an issue with `linkedProjectIds` writes `issue_projects` rows
 *    (one primary + one per linked project) and rejects invalid ids.
 * 2. The `/linked` route returns the primary + linked projects.
 * 3. `materializeLinkedWorktrees` creates the SAME branch in each linked repo,
 *    tolerating a failing repo without aborting the rest.
 */

function gitSync(args: string[], cwd: string): void {
  spawnNodeSync(['git', ...args], { cwd })
}

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'bkd-linked-repo-'))
  gitSync(['init'], repo)
  gitSync(['config', 'user.email', 'test@example.com'], repo)
  gitSync(['config', 'user.name', 'BkD Test'], repo)
  writeFileSync(join(repo, 'README.md'), 'x\n')
  gitSync(['add', '.'], repo)
  gitSync(['commit', '-m', 'init'], repo)
  return repo
}

const cleanupDirs: string[] = []

afterAll(() => {
  for (const dir of cleanupDirs) {
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

describe('create issue with linkedProjectIds', () => {
  test('writes one primary + one linked row, and /linked returns them', async () => {
    const primaryId = await createTestProject(`Primary ${Date.now()}`)
    const linkedId = await createTestProject(`Linked ${Date.now()}`)

    const res = await post<{ id: string }>(`/api/projects/${primaryId}/issues`, {
      title: 'Multi-project issue',
      statusId: 'todo',
      engineType: 'claude-code',
      model: 'auto',
      linkedProjectIds: [linkedId, linkedId, primaryId], // dup + self should be deduped/dropped
    })
    const issue = expectSuccess(res)

    const rows = await db
      .select()
      .from(issueProjectsTable)
      .where(eq(issueProjectsTable.issueId, issue.id))
    expect(rows.length).toBe(2)
    const primaryRow = rows.find(r => r.isPrimary)
    const linkedRow = rows.find(r => !r.isPrimary)
    expect(primaryRow?.projectId).toBe(primaryId)
    expect(linkedRow?.projectId).toBe(linkedId)

    const linkedRes = await get<Array<{ projectId: string, isPrimary: boolean }>>(
      `/api/projects/${primaryId}/issues/${issue.id}/linked`,
    )
    const linked = expectSuccess(linkedRes)
    expect(linked.length).toBe(2)
    expect(linked.find(p => p.isPrimary)?.projectId).toBe(primaryId)
    expect(linked.some(p => !p.isPrimary && p.projectId === linkedId)).toBe(true)
  })

  test('rejects a non-existent linked project id', async () => {
    const primaryId = await createTestProject(`Primary2 ${Date.now()}`)
    const res = await post<{ id: string }>(`/api/projects/${primaryId}/issues`, {
      title: 'Bad link',
      statusId: 'todo',
      engineType: 'claude-code',
      model: 'auto',
      linkedProjectIds: ['does-not-exist'],
    })
    expect(res.json.success).toBe(false)
    expect(res.status).toBe(400)
  })

  test('rejects an archived linked project id', async () => {
    const primaryId = await createTestProject(`Primary3 ${Date.now()}`)
    const archivedId = await createTestProject(`Archived ${Date.now()}`)
    await db
      .update(projectsTable)
      .set({ isArchived: 1 })
      .where(eq(projectsTable.id, archivedId))

    const res = await post<{ id: string }>(`/api/projects/${primaryId}/issues`, {
      title: 'Archived link',
      statusId: 'todo',
      engineType: 'claude-code',
      model: 'auto',
      linkedProjectIds: [archivedId],
    })
    expect(res.json.success).toBe(false)
    expect(res.status).toBe(400)
  })
})

describe('materializeLinkedWorktrees', () => {
  test('creates the SAME branch in each linked repo and tolerates failures', async () => {
    // A real issue is required: issue_projects.issueId FKs to issues.id.
    const ownerProjectId = await createTestProject(`MatOwner ${Date.now()}`)
    const issueRes = await post<{ id: string }>(`/api/projects/${ownerProjectId}/issues`, {
      title: 'Materialize issue',
      statusId: 'todo',
      engineType: 'claude-code',
      model: 'auto',
    })
    const issueId = expectSuccess(issueRes).id
    const branch = `bkd/linked-${Date.now()}`

    // Two real linked repos + one project with no directory (forced failure).
    const repoA = makeRepo()
    const repoB = makeRepo()
    cleanupDirs.push(repoA, repoB)

    const projA = (await db.insert(projectsTable).values({
      name: `linkedA-${Date.now()}`,
      alias: `linkeda${Date.now()}`.slice(0, 30),
      directory: repoA,
    }).returning())[0]!
    const projB = (await db.insert(projectsTable).values({
      name: `linkedB-${Date.now()}`,
      alias: `linkedb${Date.now()}`.slice(0, 30),
      directory: repoB,
    }).returning())[0]!
    const projNoDir = (await db.insert(projectsTable).values({
      name: `linkedNoDir-${Date.now()}`,
      alias: `linkednodir${Date.now()}`.slice(0, 30),
      directory: null,
    }).returning())[0]!

    // Wire link rows (all non-primary).
    await db.insert(issueProjectsTable).values([
      { issueId, projectId: projA.id, isPrimary: false },
      { issueId, projectId: projB.id, isPrimary: false },
      { issueId, projectId: projNoDir.id, isPrimary: false },
    ])

    const errors: Array<{ name: string, reason: string }> = []
    const linked = await materializeLinkedWorktrees(issueId, branch, (name, reason) =>
      errors.push({ name, reason }))

    // Two succeed (repoA, repoB), the no-directory one is reported and skipped.
    expect(linked.length).toBe(2)
    expect(errors.length).toBe(1)
    expect(errors[0]!.name).toBe(projNoDir.name)

    // Each successful worktree exists on the SAME branch.
    for (const proj of [projA, projB]) {
      const wt = resolveWorktreePath(proj.id, issueId)
      expect(existsSync(wt)).toBe(true)
      const head = spawnNodeSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wt })
      expect(head.stdout.trim()).toBe(branch)
    }

    // Cleanup worktrees.
    for (const w of linked) {
      const repo = w.projectId === projA.id ? repoA : repoB
      await removeWorktree(repo, w.path)
    }
    for (const proj of [projA, projB]) {
      const projDir = resolveWorktreePath(proj.id, issueId)
      try {
        if (existsSync(projDir)) rmSync(projDir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }
  })
})
