import type { AppEventMap } from '@bkd/shared'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs as logsTable } from '@/db/schema'
import { isVisible } from '@/engines/issue/utils/visibility'
import { liveConverter } from '@/engines/timeline-converter'
import { getBus } from '@/events'
import type { EngineContext } from '../context'
import { getMaxSequence } from '../persistence/queries'

/**
 * Issues whose `liveConverter.lastSeq` has been rehydrated from persisted rows
 * this lifecycle (PLAN-032). Cleared on flush/reset so a restarted process
 * re-seeds from `max(sequence)` on the next turn and never regresses below
 * already-stored seqs.
 */
const seededIssues = new Set<string>()

/**
 * Order 90 — Timeline conversion stage.
 *
 * Runs each NormalizedLogEntry through the per-issue stateful TimelineConverter
 * exactly once (regardless of how many SSE clients are connected) and re-emits
 * the produced TimelineEntries on the `timeline-entry` channel.
 *
 * Why a pipeline stage and not the SSE handler?
 *   The SSE handler runs per-connection. If conversion happened there,
 *   N connected clients would advance the converter's internal state N times
 *   per log entry — sequence numbers would inflate, segment counters would
 *   drift, and clients would diverge.
 *
 * Streaming and visibility gates moved here so this stage matches the SSE
 * subscriber's input filter: SSE simply forwards `timeline-entry` events.
 */
export function registerTimelineEmitStage(
  _ctx: EngineContext,
  on: (cb: (data: AppEventMap['log']) => void, opts: { order: number }) => () => void,
): () => void {
  return on(
    (data) => {
      // `dbOnly` entries are the merged final-content snapshots produced by
      // engine normalizers (currently ACP's `flushAssistantMessage` /
      // `flushThinkingMessage` at `acp-prompt-result`). They exist solely so
      // the persist stage (order 10) can land the full merged content in
      // `issue_logs` — streaming chunks themselves are dropped there. Letting
      // them re-enter `liveConverter.ingest` here would open a fresh segment
      // next to the streaming buffer that already holds the same content,
      // producing duplicate assistant/thinking bubbles per turn. See PLAN-009.
      if (data.entry.metadata?.dbOnly === true) return

      // Tool-use streaming updates are dropped — only the final non-streaming
      // tool entry reaches clients. Assistant + thinking streaming chunks pass
      // so users see real-time generation.
      if (
        data.streaming
        && data.entry.entryType !== 'assistant-message'
        && data.entry.entryType !== 'thinking'
      ) {
        return
      }
      if (!isVisible(data.entry)) return

      // PLAN-032 — rehydrate the seq floor once per issue lifecycle so seqs
      // assigned after a process restart never regress below persisted rows.
      if (!seededIssues.has(data.issueId)) {
        seededIssues.add(data.issueId)
        const maxSeq = getMaxSequence(data.issueId)
        if (maxSeq != null) liveConverter.seedLastSeq(data.issueId, maxSeq)
      }

      const produced = liveConverter.ingest(data.issueId, data.entry)
      for (const e of produced) {
        getBus().emit('timeline-entry', { issueId: data.issueId, entry: e })
      }

      // PLAN-032 — back-fill the authoritative seq onto the persisted row.
      // Only for non-streaming events: those carry a `data.entry.messageId`
      // that the persist stage (order 10) set to the DB row id. The PRIMARY
      // produced entry (last element — preceding elements are closing snapshots
      // of PRIOR segments, already persisted) maps to this row. Streaming
      // chunks are not persisted, and `dbOnly` rows already got their seq from
      // the persist stage, so neither needs back-fill here.
      if (!data.streaming && data.entry.messageId && produced.length > 0) {
        const primary = produced.at(-1)!
        if (primary.sequence != null) {
          db.update(logsTable)
            .set({ sequence: primary.sequence })
            .where(eq(logsTable.id, data.entry.messageId))
            .run()
        }
      }
    },
    { order: 90 },
  )
}

/**
 * Flush any pending streaming buffers and reset converter state for the issue.
 * Called when an issue settles so the last in-flight thinking/assistant
 * segment lands on clients before the `done` event arrives.
 */
export function flushTimelineConverter(issueId: string): void {
  const tail = liveConverter.flush(issueId)
  for (const e of tail) {
    getBus().emit('timeline-entry', { issueId, entry: e })
  }
  liveConverter.reset(issueId)
  // Drop the rehydration marker so the next turn re-seeds from persisted rows.
  seededIssues.delete(issueId)
}
