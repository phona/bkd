import type { WorktreeState } from '@bkd/shared'
import { eq, max } from 'drizzle-orm'
import { ulid } from 'ulid'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { indexLog } from '@/db/fts'
import { issues as issuesTable, issueLogs as logsTable } from '@/db/schema'
import { emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'

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
): Promise<void> {
  try {
    if (issue.worktreeState === 'active') return
    const branch = resolveWorktreeBranch(issue)
    await setWorktreeState(issue.id, 'active')
    await appendWorktreeNote(issue.id, `已创建 worktree（分支 ${branch}）`)
  } catch (err) {
    logger.warn({ issueId: issue.id, err }, 'mark_worktree_active_failed')
  }
}
