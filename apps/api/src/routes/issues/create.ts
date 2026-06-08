import { and, desc, eq, inArray, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { findProject, getDefaultEngine, getEngineDefaultModel, getServerUrl } from '@/db/helpers'
import { issueProjects as issueProjectsTable, issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { deriveWorktreeBranch } from '@/engines/issue/utils/worktree'
import type { EngineType } from '@/engines/types'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { buildIssueUrl, dispatch as webhookDispatch } from '@/webhooks/dispatcher'
import {
  parseProjectEnvVars,
  serializeIssue,
  serializeTags,
  triggerIssueExecution,
} from './_shared'

const create = createOpenAPIRouter()

// POST /api/projects/:projectId/issues — Create issue
create.openapi(R.createIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const body = c.req.valid('json')

  // Multi-project association (PLAN-037): validate the linked project ids up
  // front. Dedup, drop the primary if included, then require each to exist,
  // not be soft-deleted, and not be archived.
  let linkedProjectIds: string[] = []
  if (body.linkedProjectIds && body.linkedProjectIds.length > 0) {
    const requested = [...new Set(body.linkedProjectIds)].filter(pid => pid !== project.id)
    if (requested.length > 0) {
      const rows = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(
          and(
            inArray(projectsTable.id, requested),
            eq(projectsTable.isDeleted, 0),
            eq(projectsTable.isArchived, 0),
          ),
        )
      const valid = new Set(rows.map(r => r.id))
      const invalid = requested.filter(pid => !valid.has(pid))
      if (invalid.length > 0) {
        return c.json(
          { success: false, error: `Invalid or archived linked project(s): ${invalid.join(', ')}` },
          400 as const,
        )
      }
      linkedProjectIds = requested
    }
  }

  // Resolve engine/model defaults when not explicitly provided
  let resolvedEngine = body.engineType ?? null
  let resolvedModel = body.model ?? null

  if (!resolvedEngine) {
    const defaultEng = (await getDefaultEngine()) || 'claude-code'
    // Legacy bare 'acp' maps to 'acp:gemini' (the default ACP agent)
    resolvedEngine = (defaultEng === 'acp' ? 'acp:gemini' : defaultEng) as EngineType
  }
  if (!resolvedModel) {
    // Leave model unset — let the engine CLI use its own default.
    // Only fill from saved settings if the user explicitly configured one.
    const savedModel = await getEngineDefaultModel(resolvedEngine!)
    if (savedModel && savedModel !== 'auto') {
      resolvedModel = savedModel
    }
  }

  try {
    const issuePrompt = body.title
    const shouldExecute = body.statusId === 'working' || body.statusId === 'review'
    // review → working: auto-downgrade so the execution engine picks it up
    const effectiveStatusId = body.statusId === 'review' ? 'working' : body.statusId

    const [newIssue] = await db.transaction(async (tx) => {
      // Compute next issueNumber across ALL issues (including soft-deleted) to avoid reuse
      const [maxNumRow] = await tx
        .select({ maxNum: max(issuesTable.issueNumber) })
        .from(issuesTable)
        .where(eq(issuesTable.projectId, project.id))
      const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

      // Compute sortOrder: place after the last item in the target status column
      const [lastItem] = await tx
        .select({ sortOrder: issuesTable.sortOrder })
        .from(issuesTable)
        .where(
          and(
            eq(issuesTable.projectId, project.id),
            eq(issuesTable.statusId, effectiveStatusId),
            eq(issuesTable.isDeleted, 0),
          ),
        )
        .orderBy(desc(issuesTable.sortOrder))
        .limit(1)
      const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

      const inserted = await tx
        .insert(issuesTable)
        .values({
          projectId: project.id,
          statusId: effectiveStatusId,
          issueNumber,
          title: body.title,
          tag: serializeTags(body.tags),
          sortOrder,
          useWorktree: body.useWorktree ?? false,
          worktreeBaseBranch: body.worktreeBaseBranch ?? null,
          worktreeBranchName: body.worktreeBranchName ?? null,
          worktreeAttachExisting: body.worktreeAttachExisting ?? false,
          keepAlive: body.keepAlive ?? false,
          engineType: resolvedEngine,
          model: resolvedModel,
          sessionStatus: shouldExecute ? 'pending' : null,
          prompt: issuePrompt,
        })
        .returning()

      // Multi-project association rows (PLAN-037): one primary (= the issue's
      // own project) plus one per validated linked project.
      const createdIssue = inserted[0]
      if (createdIssue) {
        await tx.insert(issueProjectsTable).values([
          { issueId: createdIssue.id, projectId: project.id, isPrimary: true },
          ...linkedProjectIds.map(pid => ({
            issueId: createdIssue.id,
            projectId: pid,
            isPrimary: false,
          })),
        ])
      }

      return inserted
    })

    // Worktree branch name: when the user left it blank, derive a readable,
    // unique, git-safe name from the title + the real issue id (the id only
    // exists after insert). Patched here, still before any execute below.
    if (newIssue && newIssue.useWorktree && !body.worktreeBranchName?.trim()) {
      const branch = await deriveWorktreeBranch(body.title, newIssue.id, project.directory || undefined)
      await db.update(issuesTable).set({ worktreeBranchName: branch }).where(eq(issuesTable.id, newIssue.id))
      newIssue.worktreeBranchName = branch
    }

    // After successful creation, invalidate relevant caches
    await cacheDel(`projectIssueIds:${project.id}`)

    const webhookPayload: Record<string, unknown> = {
      event: 'issue.created',
      issueId: newIssue!.id,
      issueNumber: newIssue!.issueNumber,
      projectId: project.id,
      projectName: project.name,
      title: body.title,
      statusId: effectiveStatusId,
      engineType: resolvedEngine,
      model: resolvedModel,
      timestamp: new Date().toISOString(),
    }
    const serverUrl = await getServerUrl()
    if (serverUrl) {
      webhookPayload.issueUrl = buildIssueUrl(serverUrl, project.id, newIssue!.id)
    }
    void webhookDispatch('issue.created', webhookPayload, `issue.created:${newIssue!.id}`)

    // Only auto-execute when created directly in working
    if (shouldExecute) {
      triggerIssueExecution(
        newIssue!.id,
        {
          engineType: resolvedEngine,
          prompt: issuePrompt,
          model: resolvedModel,
          permissionMode: body.permissionMode,
        },
        project.directory || undefined,
        project.systemPrompt,
        parseProjectEnvVars(project.envVars),
      )
    }

    return c.json({ success: true, data: serializeIssue(newIssue!) }, (shouldExecute ? 202 : 201) as 201 | 202)
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_create_failed',
    )
    return c.json(
      {
        success: false,
        error: 'Failed to create issue',
      },
      400 as const,
    )
  }
})

export default create
