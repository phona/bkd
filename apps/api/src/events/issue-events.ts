import type { NormalizedLogEntry } from '@bkd/shared'
import { getBus } from './bus-ref'

export function emitIssueUpdated(
  issueId: string,
  changes: Record<string, unknown>,
  title?: string,
  projectAlias?: string,
  source?: string,
): void {
  getBus().emit('issue-updated', { issueId, changes, title, projectAlias, source })
}

export function emitIssueLogUpdated(issueId: string, entry: NormalizedLogEntry): void {
  getBus().emit('log-updated', { issueId, entry })
}

export function emitIssueLogRemoved(issueId: string, messageIds: string[]): void {
  if (messageIds.length === 0) return
  getBus().emit('log-removed', { issueId, messageIds })
}

export function emitIssueLogAdded(issueId: string, logId: string): void {
  getBus().emit('log-added', { issueId, logId })
}
