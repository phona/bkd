import { resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { cacheDel, cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { findProject, getServerUrl } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { getEngine } from '@/engines/issue'
import {
  deleteBranch as deleteGitBranch,
  getLinkedProjects,
  isWorktreeRegistered,
  removeWorktree,
  resolveWorktreePath,
} from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { buildIssueUrl, dispatch as webhookDispatch } from '@/webhooks/dispatcher'

const del = createOpenAPIRouter()

// DELETE /api/projects/:projectId/issues/:issueId — Soft-delete an issue
del.openapi(R.deleteIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const [existing] = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.id, issueId),
        eq(issuesTable.projectId, project.id),
        eq(issuesTable.isDeleted, 0),
      ),
    )
  if (!existing) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  // Best-effort terminate: try to kill active processes before soft-delete.
  // Use a short timeout (5s) so the DELETE request doesn't block on lock
  // contention. If termination fails or times out, proceed with deletion
  // anyway — the reconciler will clean up orphaned processes on its next run.
  const engine = getEngine()
  const shouldTerminate =
    existing.sessionStatus === 'running' ||
    existing.sessionStatus === 'pending' ||
    engine.hasActiveProcessForIssue(issueId)
  if (shouldTerminate) {
    try {
      await Promise.race([
        engine.terminateProcess(issueId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('terminate timeout')), 5_000),
        ),
      ])
    } catch (err) {
      logger.warn({ issueId, err }, 'delete_terminate_failed_proceeding')
    }
  }

  // Optional worktree cleanup (AoE DeleteSessionDialog parity). Best-effort:
  // failures are logged but never block the issue soft-delete.
  if (existing.useWorktree) {
    const { deleteWorktree, forceDelete, deleteBranch } = c.req.valid('query')
    const wantDeleteWorktree = deleteWorktree === 'true'
    const wantForce = forceDelete === 'true'
    const wantDeleteBranch = deleteBranch === 'true'

    if (wantDeleteWorktree || wantDeleteBranch) {
      const branchName = existing.worktreeBranchName?.trim() || `bkd/${issueId}`

      // The issue's worktree set spans the primary + every linked project
      // (PLAN-037 P3). Same branch name in each repo; each repo uses its own
      // directory as baseDir. Best-effort per repo — never blocks soft-delete.
      const linked = await getLinkedProjects(issueId)
      const repos = [
        { id: project.id, dir: project.directory },
        ...linked.map(l => ({ id: l.id, dir: l.directory })),
      ].filter((r): r is { id: string, dir: string } => !!r.dir)
      // Primary always cleaned even if its directory is unset (cwd fallback).
      if (!project.directory && !repos.some(r => r.id === project.id)) {
        repos.unshift({ id: project.id, dir: process.cwd() })
      }

      for (const repo of repos) {
        const baseDir = resolve(repo.dir)
        const worktreePath = resolveWorktreePath(repo.id, issueId)

        if (wantDeleteWorktree) {
          try {
            await removeWorktree(baseDir, worktreePath, wantForce)
            logger.info({ projectId: repo.id, issueId, worktreePath }, 'issue_delete_worktree_removed')
          } catch (err) {
            logger.warn({ projectId: repo.id, issueId, worktreePath, err }, 'issue_delete_worktree_remove_failed')
          }
        }

        if (wantDeleteBranch) {
          try {
            // If the worktree is still registered (e.g. removal skipped/failed),
            // git refuses to delete the checked-out branch — that is expected.
            const stillRegistered = wantDeleteWorktree ?
              false :
                await isWorktreeRegistered(baseDir, worktreePath)
            if (!stillRegistered) {
              await deleteGitBranch(baseDir, branchName, true)
              logger.info({ projectId: repo.id, issueId, branchName }, 'issue_delete_branch_removed')
            }
          } catch (err) {
            logger.warn({ projectId: repo.id, issueId, branchName, err }, 'issue_delete_branch_remove_failed')
          }
        }
      }
    }
  }

  // Soft-delete the issue only — keep logs/tools/attachments intact for restore
  await db.transaction(async (tx) => {
    await tx
      .update(issuesTable)
      .set({ isDeleted: 1 })
      .where(eq(issuesTable.id, issueId))
  })

  // Invalidate caches
  await cacheDel(`issue:${project.id}:${issueId}`)
  await cacheDelByPrefix(`projectIssueIds:${project.id}`)

  logger.info({ projectId: project.id, issueId }, 'issue_deleted')

  const webhookPayload: Record<string, unknown> = {
    event: 'issue.deleted',
    issueId,
    issueNumber: existing.issueNumber,
    projectId: project.id,
    projectName: project.name,
    title: existing.title,
    timestamp: new Date().toISOString(),
  }
  const serverUrl = await getServerUrl()
  if (serverUrl) {
    webhookPayload.issueUrl = buildIssueUrl(serverUrl, project.id, issueId)
  }
  void webhookDispatch('issue.deleted', webhookPayload, `issue.deleted:${issueId}`)

  return c.json({ success: true, data: { id: issueId } }, 200 as const)
})

export default del
