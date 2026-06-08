import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import type { EngineContext } from '@/engines/issue/context'
import { emitDiagnosticLog, emitErrorLog } from '@/engines/issue/diagnostic'
import { emitStateChange } from '@/engines/issue/events'
import { monitorCompletion } from '@/engines/issue/lifecycle/completion-monitor'
import { handleTurnCompleted } from '@/engines/issue/lifecycle/turn-completion'
import { ensureNoActiveProcess } from '@/engines/issue/process/guards'
import { withIssueLock } from '@/engines/issue/process/lock'
import { register } from '@/engines/issue/process/register'
import { persistUserMessage } from '@/engines/issue/user-message'
import { formatSpawnError, getPermissionOptions } from '@/engines/issue/utils/helpers'
import { createLogNormalizer } from '@/engines/issue/utils/normalizer'
import { getPidFromSubprocess } from '@/engines/issue/utils/pid'
import { buildLinkedReposPromptSuffix, createWorktree, materializeLinkedWorktrees } from '@/engines/issue/utils/worktree'
import { markWorktreeActive } from '@/engines/issue/utils/worktree-state'
import { parseAcpEngineType } from '@/engines/startup-probe'
import type { EngineType, PermissionPolicy, SpawnedProcess } from '@/engines/types'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'

export async function executeIssue(
  ctx: EngineContext,
  issueId: string,
  opts: {
    engineType: EngineType
    prompt: string
    workingDir?: string
    model?: string
    permissionMode?: PermissionPolicy
    envVars?: Record<string, string>
    displayPrompt?: string
    metadata?: Record<string, unknown>
  },
): Promise<{ executionId: string, messageId?: string | null }> {
  return withIssueLock(ctx, issueId, async () => {
    logger.debug(
      {
        issueId,
        engineType: opts.engineType,
        model: opts.model,
        hasWorkingDir: !!opts.workingDir,
      },
      'issue_execute_requested',
    )
    const issue = await getIssueWithSession(issueId)
    if (!issue) throw new Error(`Issue not found: ${issueId}`)
    ensureNoActiveProcess(ctx, issueId)

    const executor = engineRegistry.get(opts.engineType)
    if (!executor) throw new Error(`No executor for engine type: ${opts.engineType}`)

    // Guard: reject engines that are registered but not yet executable.
    const avail = await executor.getAvailability()
    if (avail.executable === false) {
      throw new Error(`Engine '${opts.engineType}' is not yet executable (spawn not implemented)`)
    }

    // Treat 'auto' as unset — let the engine CLI use its own default.
    // Do NOT look up or fill in a default model from DB; the engine decides.
    const model = opts.model === 'auto' ? undefined : opts.model

    await updateIssueSession(issueId, {
      engineType: opts.engineType,
      sessionStatus: 'running',
      prompt: opts.prompt,
      model: model ?? undefined,
    })

    const baseDir = opts.workingDir ?? ROOT_DIR
    let workingDir = baseDir
    let worktreePath: string | undefined
    // PLAN-037: prompt fed to the engine; gains a suffix listing the linked
    // repos' worktree paths when multi-project association is in play.
    let effectivePrompt = opts.prompt

    if (issue.useWorktree) {
      try {
        worktreePath = await createWorktree(
          baseDir,
          issue.projectId,
          issueId,
          {
            startPointRef: issue.worktreeBaseBranch ?? undefined,
            branchNameOverride: issue.worktreeBranchName ?? undefined,
            attachExisting: issue.worktreeAttachExisting ?? false,
          },
        )
        workingDir = worktreePath
        // PLAN-038: track the worktree as active (no-op + no chat note if it
        // was already active) — surfaces a留痕 note on a real transition.
        await markWorktreeActive(issue)

        // Multi-project association (PLAN-037): materialize a worktree on the
        // SAME branch in every linked repo (each repo's own base + fetch).
        // Partial-failure tolerant — a failing repo is surfaced in chat and
        // skipped; the primary execution always proceeds. The agent's cwd
        // stays the primary worktree; linked paths are injected into the prompt.
        const resolvedBranch = issue.worktreeBranchName ?? undefined
        if (resolvedBranch) {
          const linked = await materializeLinkedWorktrees(
            issueId,
            resolvedBranch,
            (projectName, reason) => {
              emitDiagnosticLog(
                issueId,
                '',
                `[BKD] linked repo ${projectName} worktree failed: ${reason}`,
                { event: 'linked_worktree_failed', projectName },
              )
            },
          )
          effectivePrompt += buildLinkedReposPromptSuffix(linked)
        }
      } catch (error) {
        // `err` (not `error`) so pino's error serializer records the real
        // message/stack instead of an empty {} — the fallback reason matters.
        logger.warn({ issueId, err: error }, 'worktree_creation_failed_fallback_to_base')
        emitDiagnosticLog(
          issueId,
          '',
          '[BKD] Worktree creation failed — running in the shared project directory without isolation. '
          + `Reason: ${error instanceof Error ? error.message : String(error)}`,
          { event: 'worktree_fallback' },
        )
      }
    }

    const permOptions = getPermissionOptions(opts.engineType, opts.permissionMode)
    const externalSessionId = crypto.randomUUID()
    const executionId = crypto.randomUUID()

    // For virtual ACP engine types (e.g. "acp:claude"), pass the agent ID
    // so the executor knows which agent binary to spawn even when model is empty.
    const acpAgent = parseAcpEngineType(opts.engineType) ?? undefined

    let spawned: SpawnedProcess
    try {
      spawned = await executor.spawn(
        {
          workingDir,
          prompt: effectivePrompt,
          model,
          permissionMode: permOptions.permissionMode,
          externalSessionId,
          agent: acpAgent,
        },
        {
          vars: opts.envVars ?? {},
          workingDir,
          projectId: issue.projectId,
          issueId,
        },
      )
    } catch (spawnError) {
      logger.error(
        { issueId, executionId, err: spawnError },
        'execute_spawn_failed_reverting_session',
      )
      const errorMsg = formatSpawnError(spawnError)
      emitDiagnosticLog(
        issueId,
        executionId,
        `[BKD] Process spawn failed: ${errorMsg}`,
        { event: 'spawn_failed' },
      )
      emitErrorLog(issueId, executionId, errorMsg)
      await updateIssueSession(issueId, { sessionStatus: 'failed' }).catch(e =>
        logger.error({ issueId, err: e }, 'execute_spawn_failed_revert_session_error'),
      )
      emitStateChange(issueId, executionId, 'failed')
      throw spawnError
    }

    // Allow executor to override the external session ID (e.g. Codex uses server-generated thread IDs)
    const finalExternalSessionId = spawned.externalSessionId ?? externalSessionId
    await updateIssueSession(issueId, {
      externalSessionId: finalExternalSessionId,
    })
    const pid = getPidFromSubprocess(spawned.subprocess)
    logger.info(
      {
        issueId,
        executionId,
        pid,
        engineType: opts.engineType,
        externalSessionId: finalExternalSessionId,
        worktreePath,
      },
      'issue_execute_spawned',
    )
    const normalizer = createLogNormalizer(executor)

    register(
      ctx,
      executionId,
      issueId,
      opts.engineType,
      spawned,
      line => normalizer.parse(line),
      0,
      worktreePath,
      () => handleTurnCompleted(ctx, issueId, executionId),
      worktreePath ? baseDir : undefined,
      workingDir,
      finalExternalSessionId,
      issue.keepAlive,
    )
    emitDiagnosticLog(
      issueId,
      executionId,
      `[BKD] Process spawned (engine=${opts.engineType}, pid=${pid}, model=${model ?? 'default'})`,
      { event: 'process_spawned', pid, engineType: opts.engineType, model },
    )
    const messageId = persistUserMessage(ctx, issueId, executionId, opts.prompt, opts.displayPrompt, opts.metadata)
    monitorCompletion(ctx, executionId, issueId, opts.engineType, false)

    return { executionId, messageId }
  })
}
