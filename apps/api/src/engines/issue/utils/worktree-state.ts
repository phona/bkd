import { basename } from 'node:path'
import type { WorktreeState } from '@bkd/shared'
import { eq, max } from 'drizzle-orm'
import { ulid } from 'ulid'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import { indexLog } from '@/db/fts'
import { issues as issuesTable, issueLogs as logsTable } from '@/db/schema'
import { runCommand } from '@/engines/spawn'
import { emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'
import { WORKTREE_SETUP_SCRIPT_KEY } from '@/routes/settings/worktree-keys'

/**
 * Resolve the actual git branch name a worktree uses. Matches the convention
 * in `createWorktree` / `delete.ts`: the user-chosen name, else `bkd/{issueId}`.
 */
export function resolveWorktreeBranch(
  issue: { id: string, worktreeBranchName?: string | null },
): string {
  return issue.worktreeBranchName?.trim() || `bkd/${issue.id}`
}

/**
 * Persist the tracked worktree lifecycle state (PLAN-038). Best-effort:
 * failures are logged (never thrown) so a state-bookkeeping miss never breaks
 * the surrounding git/execution flow. Invalidates the issue cache and pushes an
 * `issue-updated` SSE event so the badge updates live.
 */
export async function setWorktreeState(issueId: string, state: WorktreeState): Promise<void> {
  try {
    const [row] = await db
      .update(issuesTable)
      .set({ worktreeState: state })
      .where(eq(issuesTable.id, issueId))
      .returning({ projectId: issuesTable.projectId })
    if (row) {
      await cacheDel(`issue:${row.projectId}:${issueId}`)
      emitIssueUpdated(issueId, { worktreeState: state }, undefined, undefined, 'engine')
    }
  } catch (err) {
    logger.warn({ issueId, state, err }, 'set_worktree_state_failed')
  }
}

/**
 * Append a one-line `system-message` to an issue's timeline so a worktree
 * lifecycle transition is visible (留痕) in chat. Best-effort.
 */
export async function appendWorktreeNote(issueId: string, content: string): Promise<void> {
  try {
    const [maxRow] = await db
      .select({ maxTurn: max(logsTable.turnIndex) })
      .from(logsTable)
      .where(eq(logsTable.issueId, issueId))
    const turnIndex = (maxRow?.maxTurn ?? 0) + 1
    const logId = ulid()
    db.insert(logsTable)
      .values({
        id: logId,
        issueId,
        turnIndex,
        entryIndex: 0,
        entryType: 'system-message',
        content,
        metadata: JSON.stringify({ kind: 'worktree-lifecycle' }),
        visible: 1,
      })
      .run()
    indexLog(logId, content)
  } catch (err) {
    logger.warn({ issueId, err }, 'worktree_note_failed')
  }
}

/**
 * Flip a worktree to `active` after a successful create. Idempotent: when the
 * issue is already `active` this is a no-op (no DB write, no duplicate chat
 * note) so repeated executes don't spam the timeline. Emits the create留痕
 * note only on a real transition (`none`/`cleaned` → `active`).
 */
export async function markWorktreeActive(
  issue: { id: string, worktreeState?: string | null, worktreeBranchName?: string | null },
): Promise<boolean> {
  try {
    if (issue.worktreeState === 'active') return false
    const branch = resolveWorktreeBranch(issue)
    await setWorktreeState(issue.id, 'active')
    await appendWorktreeNote(issue.id, `已创建 worktree（分支 ${branch}）`)
    return true
  } catch (err) {
    logger.warn({ issueId: issue.id, err }, 'mark_worktree_active_failed')
    return false
  }
}

/**
 * Run the global `worktree:setupScript` (PLAN-039) in a freshly created worktree
 * before the agent spawns (AoE `on_create` parity). Best-effort: a failure or
 * timeout is surfaced as a visible warning 留痕 note but never hard-fails the
 * issue. Caller MUST gate this to run once per worktree creation (e.g. on the
 * `none/cleaned → active` transition / `created` flag) so follow-ups/restarts
 * don't re-run it.
 *
 * @param issueId   The issue (for the timeline note).
 * @param worktreeDir The primary worktree directory (cwd + PROJECT_PATH).
 * @param branch    The resolved branch name (BRANCH env).
 */
export async function runWorktreeSetupScript(
  issueId: string,
  worktreeDir: string,
  branch: string,
): Promise<void> {
  const script = (await getAppSetting(WORKTREE_SETUP_SCRIPT_KEY))?.trim()
  if (!script) return

  await appendWorktreeNote(issueId, '运行 setup 脚本…')
  const startedAt = Date.now()
  try {
    const res = await runCommand(['bash', '-lc', script], {
      cwd: worktreeDir,
      stderr: 'pipe',
      timeout: 300000,
      env: {
        ...process.env,
        REPO_NAME: basename(worktreeDir),
        BRANCH: branch,
        ISSUE_ID: issueId,
        PROJECT_PATH: worktreeDir,
      },
    })
    const ms = Date.now() - startedAt
    if (res.timedOut) {
      const tail = res.stderr.trim().slice(-400)
      await appendWorktreeNote(issueId, `⚠️ setup 脚本超时（300s）${tail ? `：\n${tail}` : ''}`)
      logger.warn({ issueId, worktreeDir }, 'worktree_setup_script_timeout')
      return
    }
    if (res.code !== 0) {
      const tail = res.stderr.trim().slice(-400)
      await appendWorktreeNote(issueId, `⚠️ setup 脚本失败（exit ${res.code}）${tail ? `：\n${tail}` : ''}`)
      logger.warn({ issueId, worktreeDir, code: res.code }, 'worktree_setup_script_failed')
      return
    }
    await appendWorktreeNote(issueId, `setup 脚本完成（${Math.round(ms / 1000)}s）`)
    logger.debug({ issueId, worktreeDir, ms }, 'worktree_setup_script_done')
  } catch (err) {
    await appendWorktreeNote(issueId, `⚠️ setup 脚本执行异常：${err instanceof Error ? err.message : String(err)}`)
    logger.warn({ issueId, worktreeDir, err }, 'worktree_setup_script_error')
  }
}
