import { stat } from 'node:fs/promises'
import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issueProjects as issueProjectsTable, issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { resolveWorktreePath } from '@/engines/issue/utils/worktree'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { getProjectOwnedIssue, serializeIssue } from './_shared'
import type { IssueRow } from './_shared'

const query = createOpenAPIRouter()

interface TreeIssue {
  id: string
  title: string
  statusId: string
  issueNumber: number
  parentIssueId: string | null
  children: TreeIssue[]
}

function buildIssueTree(issues: IssueRow[]): TreeIssue[] {
  const map = new Map<string, TreeIssue>()
  const roots: TreeIssue[] = []

  for (const issue of issues) {
    map.set(issue.id, {
      id: issue.id,
      title: issue.title,
      statusId: issue.statusId,
      issueNumber: issue.issueNumber,
      parentIssueId: issue.parentIssueId ?? null,
      children: [],
    })
  }
  for (const issue of issues) {
    const node = map.get(issue.id)!
    if (issue.parentIssueId && map.has(issue.parentIssueId)) {
      map.get(issue.parentIssueId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// GET /api/projects/:projectId/issues — List issues
query.openapi(R.listIssues, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const rows = await db
    .select()
    .from(issuesTable)
    .where(and(
      eq(issuesTable.projectId, project.id),
      eq(issuesTable.isDeleted, 0),
      eq(issuesTable.isHidden, false),
    ))
    .orderBy(desc(issuesTable.isPinned), desc(issuesTable.statusUpdatedAt))

  if (c.req.query('tree') === 'true') {
    const tree = buildIssueTree(rows)
    return c.json({ success: true, data: tree }, 200 as const)
  }

  return c.json({
    success: true,
    data: rows.map(r => serializeIssue(r)),
  }, 200 as const)
})

// GET /api/projects/:projectId/issues/:issueId — Get single issue
query.openapi(R.getIssue, async (c) => {
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

  // Child issues forked from this one (lineage chip).
  const forkRows = await db
    .select({
      id: issuesTable.id,
      issueNumber: issuesTable.issueNumber,
      title: issuesTable.title,
      statusId: issuesTable.statusId,
    })
    .from(issuesTable)
    .where(and(
      eq(issuesTable.parentIssueId, issueId),
      eq(issuesTable.isDeleted, 0),
    ))
    .orderBy(desc(issuesTable.createdAt))

  return c.json({
    success: true,
    data: { ...serializeIssue(issue), forks: forkRows },
  }, 200 as const)
})

// GET /api/projects/:projectId/issues/:issueId/linked — Projects linked to an
// issue (multi-project association, PLAN-037). `worktreePath` is the on-disk
// worktree for that project+issue if it exists, else null.
query.openapi(R.getIssueLinkedProjects, async (c) => {
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

  const rows = await db
    .select({
      projectId: projectsTable.id,
      name: projectsTable.name,
      directory: projectsTable.directory,
      isPrimary: issueProjectsTable.isPrimary,
    })
    .from(issueProjectsTable)
    .innerJoin(projectsTable, eq(issueProjectsTable.projectId, projectsTable.id))
    .where(and(
      eq(issueProjectsTable.issueId, issueId),
      eq(issueProjectsTable.isDeleted, 0),
      eq(projectsTable.isDeleted, 0),
    ))
    .orderBy(desc(issueProjectsTable.isPrimary), asc(projectsTable.name))

  const data = await Promise.all(rows.map(async (row) => {
    const wt = resolveWorktreePath(row.projectId, issueId)
    let worktreePath: string | null = null
    try {
      if ((await stat(wt)).isDirectory()) worktreePath = wt
    } catch {
      worktreePath = null
    }
    return {
      projectId: row.projectId,
      name: row.name,
      directory: row.directory ?? null,
      worktreePath,
      isPrimary: row.isPrimary,
    }
  }))

  return c.json({ success: true, data }, 200 as const)
})

export default query
