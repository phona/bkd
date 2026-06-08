import { readdir, rmdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { inArray } from 'drizzle-orm'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { removeWorktree, WORKTREE_BASE } from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'

export const WORKTREE_AUTO_CLEANUP_KEY = 'worktree:autoCleanup'

/** Max entries per inArray batch to stay within SQLite variable limits */
const MAX_BATCH = 500

/**
 * Gate: when `false` (the default — no `worktree:autoCleanup` row, or any value
 * other than `'true'`), the orphan prune is skipped. The setting now means
 * "auto-prune orphaned worktrees" (PLAN-038 P3 downgrade); the historical
 * "done ≥ 1 day" auto-delete is gone.
 */
async function isAutoCleanupEnabled(): Promise<boolean> {
  const value = await getAppSetting(WORKTREE_AUTO_CLEANUP_KEY)
  return value === 'true'
}

/** Best-effort: remove `dir` only if it is now empty (mirrors prune_empty_parent_dirs). */
async function pruneEmptyDir(dir: string): Promise<void> {
  try {
    const remaining = await readdir(dir)
    if (remaining.length === 0) await rmdir(dir)
  } catch {
    /* best effort — non-empty / already gone */
  }
}

/**
 * Orphan-only worktree prune (PLAN-038 P3).
 *
 * Walks `WORKTREE_BASE/{projectDir}/{issueId}` and removes a worktree ONLY when
 * its issue row is GONE from the `issues` table — i.e. the row was hard-deleted
 * or never existed. Soft-deleted issues (`isDeleted=1`) still have a row and are
 * restorable, so their worktrees are KEPT. This never touches worktrees for any
 * issue that still exists (active or done). After removal, empty project wrapper
 * dirs are pruned.
 */
export async function runWorktreeCleanup(): Promise<string> {
  if (!(await isAutoCleanupEnabled())) return 'skipped (auto-cleanup disabled)'

  const worktreeBaseDir = WORKTREE_BASE
  let projectEntries: import('node:fs').Dirent[]
  try {
    projectEntries = await readdir(worktreeBaseDir, { withFileTypes: true })
  } catch {
    return 'skipped (no worktree directory)'
  }

  const projectDirNames = projectEntries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .slice(0, MAX_BATCH)

  if (projectDirNames.length === 0) return 'no projects with worktrees'

  const projectRows = await db
    .select({ id: projectsTable.id, directory: projectsTable.directory })
    .from(projectsTable)
    .where(inArray(projectsTable.id, projectDirNames))
  const projectMap = new Map(projectRows.map(p => [p.id, p.directory]))

  let cleaned = 0

  for (const projectDirName of projectDirNames) {
    const projectWorktreeDir = join(worktreeBaseDir, projectDirName)

    let issueEntries: import('node:fs').Dirent[]
    try {
      issueEntries = await readdir(projectWorktreeDir, { withFileTypes: true })
    } catch {
      continue
    }

    const issueIds = issueEntries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .slice(0, MAX_BATCH)

    if (issueIds.length === 0) {
      await pruneEmptyDir(projectWorktreeDir)
      continue
    }

    // Any row by id counts as "exists" (no isDeleted filter): a soft-deleted
    // issue is restorable, so it is NOT an orphan. Orphan = no row at all.
    const existingRows = await db
      .select({ id: issuesTable.id })
      .from(issuesTable)
      .where(inArray(issuesTable.id, issueIds))
    const existingIds = new Set(existingRows.map(r => r.id))

    const orphanIds = issueIds.filter(id => !existingIds.has(id))
    if (orphanIds.length === 0) continue

    const directory = projectMap.get(projectDirName)
    const baseDir = directory ? resolve(directory) : process.cwd()

    for (const orphanId of orphanIds) {
      const worktreePath = join(projectWorktreeDir, orphanId)
      try {
        await removeWorktree(baseDir, worktreePath)
        cleaned++
        logger.debug(
          { projectDir: projectDirName, issueId: orphanId, worktreePath },
          'worktree_orphan_cleaned',
        )
      } catch (err) {
        logger.warn(
          { projectDir: projectDirName, issueId: orphanId, worktreePath, err },
          'worktree_orphan_cleanup_failed',
        )
      }
    }

    // Prune the project wrapper dir if it is now empty.
    await pruneEmptyDir(projectWorktreeDir)
  }

  if (cleaned > 0) {
    logger.info({ cleaned }, 'worktree_orphan_cleanup_done')
  }
  return `cleaned ${cleaned} orphaned worktrees`
}
