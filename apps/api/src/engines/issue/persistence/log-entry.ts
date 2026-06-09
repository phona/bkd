import { ulid } from 'ulid'
import { db } from '@/db'
import { indexLog } from '@/db/fts'
import { issueLogs as logsTable } from '@/db/schema'
import type { NormalizedLogEntry } from '@/engines/types'
import { logger } from '@/logger'

/** Persist a single log entry to DB with explicit counter and turn values. */
export function persistLogEntry(
  issueId: string,
  executionId: string,
  entry: NormalizedLogEntry,
  entryIndex: number,
  turnIndex: number,
  replyToMessageId: string | null,
  sequence?: number | null,
): NormalizedLogEntry | null {
  try {
    const messageId = entry.messageId ?? ulid()

    db.insert(logsTable)
      .values({
        id: messageId,
        issueId,
        turnIndex,
        entryIndex,
        entryType: entry.entryType,
        content: entry.content,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        replyToMessageId,
        timestamp: entry.timestamp ?? null,
        // PLAN-032: stamp the authoritative seq when the caller already knows
        // it (currently only `dbOnly` final rows, seeded from the live
        // streaming buffer). Other rows are back-filled by the timeline-emit
        // stage once the converter assigns their seq.
        sequence: sequence ?? null,
        visible: 1,
      })
      .run()

    // Mirror content into the FTS shadow (bigram-encoded application-side).
    indexLog(messageId, entry.content)

    // Return new object — do NOT mutate the input entry
    return {
      ...entry,
      messageId,
      replyToMessageId: replyToMessageId ?? undefined,
      sequence: sequence ?? entry.sequence,
    }
  } catch (error) {
    logger.warn({ err: error, issueId }, 'persistLogEntry failed')
    return null
  }
}
