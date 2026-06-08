import { resolve } from 'node:path'
import { findProject } from '@/db/helpers'
import {
  createWorktree,
  getLinkedProjects,
  isWorktreeDirty,
  materializeLinkedWorktrees,
  removeWorktree,
  resolveWorktreePath,
} from '@/engines/issue/utils/worktree'
import {
  appendWorktreeNote,
  resolveWorktreeBranch,
  setWorktreeState,
} from '@/engines/issue/utils/worktree-state'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { getProjectOwnedIssue, invalidateIssueCache, serializeIssue } from './_shared'

const worktree = createOpenAPIRouter()

// POST /api/projects/:projectId/issues/:issueId/worktree/clean
// Remove the worktree directory (dirty-check, optional force); KEEP the branch.
// Explicit, tracked: flips worktreeState → 'cleaned' + 留痕.
worktree.openapi(R.cleanIssueWorktree, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  const { force } = c.req.valid('json')
  const branch = resolveWorktreeBranch(issue)

  // The issue's worktree set = primary + every linked project (PLAN-037 P3).
  // Each repo uses its OWN directory as baseDir but the SAME worktree path
  // convention `resolveWorktreePath(repoProjectId, issueId)`.
  const linked = await getLinkedProjects(issueId)
  const repos = [
    { id: project.id, name: project.name, dir: project.directory },
    ...linked.map(l => ({ id: l.id, name: l.name, dir: l.directory })),
  ].filter((r): r is { id: string, name: string, dir: string } => !!r.dir)

  // Dirty pre-check across ALL repos: if any is dirty and force is off, refuse
  // the whole operation (never partially clean). FE matches on 'worktree_dirty'.
  if (!force) {
    const dirtyRepos: string[] = []
    for (const repo of repos) {
      if (await isWorktreeDirty(resolveWorktreePath(repo.id, issueId))) {
        dirtyRepos.push(repo.name)
      }
    }
    if (dirtyRepos.length > 0) {
      logger.warn({ projectId: project.id, issueId, dirtyRepos }, 'worktree_clean_refused')
      return c.json({ success: false, error: 'worktree_dirty' }, 409 as const)
    }
  }

  // Remove every repo's worktree (branch always kept). Collect partial failures.
  const failedRepos: string[] = []
  for (const repo of repos) {
    const baseDir = resolve(repo.dir)
    const worktreePath = resolveWorktreePath(repo.id, issueId)
    try {
      await removeWorktree(baseDir, worktreePath, force ?? false)
    } catch (err) {
      logger.warn({ projectId: repo.id, issueId, worktreePath, err }, 'worktree_clean_failed')
      failedRepos.push(repo.name)
    }
  }

  if (failedRepos.length > 0) {
    // Partial failure: do NOT flip state to cleaned; report so the user retries.
    logger.warn({ projectId: project.id, issueId, failedRepos }, 'worktree_clean_partial_failure')
    return c.json({ success: false, error: 'worktree_dirty' }, 409 as const)
  }

  await setWorktreeState(issueId, 'cleaned')
  const repoNote = repos.length > 1 ? `${repos.length} 个仓库的 ` : ''
  await appendWorktreeNote(issueId, `已清理 ${repoNote}worktree（目录已删除，分支 ${branch} 保留）`)
  await invalidateIssueCache(project.id, issueId)

  const updated = await getProjectOwnedIssue(project.id, issueId)
  logger.info({ projectId: project.id, issueId, repoCount: repos.length, branch }, 'issue_worktree_cleaned')
  return c.json({ success: true, data: serializeIssue(updated ?? issue) }, 200 as const)
})

// POST /api/projects/:projectId/issues/:issueId/worktree/recreate
// Re-materialize the worktree (fetch + attach/checkout existing branch, else
// create from base). Explicit, tracked: flips worktreeState → 'active' + 留痕.
worktree.openapi(R.recreateIssueWorktree, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  const baseDir = project.directory ? resolve(project.directory) : process.cwd()
  const branch = resolveWorktreeBranch(issue)

  try {
    // createWorktree fetches first, then attaches the existing branch (or
    // creates it from base if it was deleted) — mirrors the original creation.
    await createWorktree(baseDir, project.id, issueId, {
      startPointRef: issue.worktreeBaseBranch ?? undefined,
      branchNameOverride: issue.worktreeBranchName ?? undefined,
      attachExisting: issue.worktreeAttachExisting ?? false,
    })
  } catch (err) {
    logger.warn({ projectId: project.id, issueId, branch, err }, 'issue_worktree_recreate_failed')
    return c.json({ success: false, error: 'worktree_recreate_failed' }, 400 as const)
  }

  // Re-materialize linked repos on the SAME branch too (PLAN-037 P3).
  // Partial-failure tolerant: a failing linked repo is logged, never aborts.
  const linkedErrors: string[] = []
  const linked = await materializeLinkedWorktrees(issueId, branch, (name, reason) => {
    linkedErrors.push(name)
    logger.warn({ projectId: project.id, issueId, linkedProject: name, reason }, 'linked_worktree_recreate_failed')
  })
  const repoCount = 1 + linked.length

  await setWorktreeState(issueId, 'active')
  const repoNote = repoCount > 1 ? `${repoCount} 个仓库的 ` : ''
  await appendWorktreeNote(issueId, `已重建 ${repoNote}worktree（分支 ${branch}）`)
  await invalidateIssueCache(project.id, issueId)

  const updated = await getProjectOwnedIssue(project.id, issueId)
  logger.info({ projectId: project.id, issueId, branch }, 'issue_worktree_recreated')
  return c.json({ success: true, data: serializeIssue(updated ?? issue) }, 200 as const)
})

export default worktree
