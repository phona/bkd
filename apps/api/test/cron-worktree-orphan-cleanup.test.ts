import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setAppSetting } from '@/db/helpers'
import { runWorktreeCleanup, WORKTREE_AUTO_CLEANUP_KEY } from '@/cron/actions/builtins/worktree-cleanup'
import { createWorktree, resolveWorktreePath } from '@/engines/issue/utils/worktree'
import { spawnNodeSync } from '@/engines/spawn'
import { createTestProject, expectSuccess, post } from './helpers'

/**
 * PLAN-038 P3 — orphan-only worktree prune.
 * Proves the downgraded cron KEEPS a worktree whose issue row still exists and
 * REMOVES a worktree whose issue id has no row at all (hard-deleted / orphan).
 */

function gitSync(args: string[], cwd: string): void {
  spawnNodeSync(['git', ...args], { cwd })
}

let gitRoot = ''
let projectId = ''
let liveIssueId = ''
const ORPHAN_ID = `orphan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

beforeAll(async () => {
  gitRoot = mkdtempSync(join(tmpdir(), 'bkd-orphan-repo-'))
  gitSync(['init'], gitRoot)
  gitSync(['config', 'user.email', 'test@example.com'], gitRoot)
  gitSync(['config', 'user.name', 'BkD Test'], gitRoot)
  writeFileSync(join(gitRoot, 'README.md'), 'x\n')
  gitSync(['add', '.'], gitRoot)
  gitSync(['commit', '-m', 'init'], gitRoot)

  projectId = await createTestProject(`Orphan ${Date.now()}`)
  // Point the project at the real git repo so cron can resolve baseDir.
  const { db } = await import('@/db')
  const { projects: projectsTable } = await import('@/db/schema')
  const { eq } = await import('drizzle-orm')
  await db.update(projectsTable).set({ directory: gitRoot }).where(eq(projectsTable.id, projectId))

  const issue = await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
    title: 'live issue',
    statusId: 'todo',
    useWorktree: true,
  })
  liveIssueId = expectSuccess(issue).id

  // Materialize a worktree for BOTH the live issue and an orphan (no row).
  await createWorktree(gitRoot, projectId, liveIssueId)
  await createWorktree(gitRoot, projectId, ORPHAN_ID)
})

afterAll(() => {
  for (const id of [liveIssueId, ORPHAN_ID]) {
    const wt = resolveWorktreePath(projectId, id)
    try {
      if (existsSync(wt)) gitSync(['worktree', 'remove', '--force', wt], gitRoot)
    } catch { /* best effort */ }
    try {
      gitSync(['branch', '-D', `bkd/${id}`], gitRoot)
    } catch { /* best effort */ }
  }
  try {
    if (gitRoot && existsSync(gitRoot)) rmSync(gitRoot, { recursive: true, force: true })
  } catch { /* best effort */ }
})

describe('runWorktreeCleanup (orphan-only)', () => {
  test('skips when auto-cleanup is disabled', async () => {
    await setAppSetting(WORKTREE_AUTO_CLEANUP_KEY, 'false')
    const result = await runWorktreeCleanup()
    expect(result).toContain('disabled')
    // Nothing removed while disabled.
    expect(existsSync(resolveWorktreePath(projectId, ORPHAN_ID))).toBe(true)
  })

  test('removes the orphan worktree but keeps the live-issue worktree', async () => {
    const liveWt = resolveWorktreePath(projectId, liveIssueId)
    const orphanWt = resolveWorktreePath(projectId, ORPHAN_ID)
    expect(existsSync(liveWt)).toBe(true)
    expect(existsSync(orphanWt)).toBe(true)

    await setAppSetting(WORKTREE_AUTO_CLEANUP_KEY, 'true')
    await runWorktreeCleanup()

    // Live issue still has a row → kept. Orphan id has no row → removed.
    expect(existsSync(liveWt)).toBe(true)
    expect(existsSync(orphanWt)).toBe(false)
  })
})
