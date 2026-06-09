import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs as logsTable } from '@/db/schema'
import { getLogsFromDb } from '@/engines/issue/persistence/queries'
import { toTimeline } from '@/engines/timeline-converter'
import type { TimelineEntry } from '@/engines/types'
import { createTestIssue, createTestProject, expectSuccess } from './helpers'

// ────────────────────────────────────────────────────────────────────────────
// PLAN-032 P1 — single persisted per-issue `sequence` namespace.
//
// The bug class this guards: `toTimeline()` builds a FRESH converter per HTTP
// page, so the live-computed `lastSeq` restarts at 0 each page. When two
// entries share a timestamp across a page boundary, the per-page converter
// re-derives COLLIDING sequences → the frontend (which sorts by `sequence`)
// renders an unstable order that jumps on every `/logs` refresh.
//
// With the persisted `sequence` column, history reads carry the authoritative
// seq through the converter instead of re-assigning it, so:
//   (a) no two distinct entries collide on `sequence` across pages,
//   (b) the SAME entry has the SAME seq in every page AND in the live/full view,
//   (c) global order is stable regardless of how the range is paginated.
// ────────────────────────────────────────────────────────────────────────────

let ISSUE_ID = ''

interface Synthetic {
  id: string
  turn: number
  entryType: string
  content: string
  timestamp: string
}

/**
 * Build a long synthetic conversation. Crucially, several entries SHARE a
 * timestamp across the turn-4/turn-5 boundary — this is exactly the input that
 * made a fresh-per-page converter collide before persisted seq.
 */
function buildEntries(): Synthetic[] {
  const out: Synthetic[] = []
  let n = 0
  const pad = (x: number) => x.toString().padStart(6, '0')
  // Base wall clock; most entries advance by 1s, but the boundary cluster
  // (last entry of turn 4 + first entries of turn 5) all share one timestamp.
  const base = Date.parse('2026-06-08T00:00:00.000Z')
  for (let turn = 0; turn < 10; turn++) {
    const turnEntries: Array<[string, string]> = [
      ['user-message', `user asks in turn ${turn}`],
      ['assistant-message', `assistant replies in turn ${turn}`],
      ['tool-use', `tool runs in turn ${turn}`],
      ['assistant-message', `assistant follows up in turn ${turn}`],
    ]
    for (const [entryType, content] of turnEntries) {
      // Collapse timestamps around the page boundary to force the collision.
      const isBoundaryCluster = (turn === 4 && entryType === 'assistant-message') || turn === 5
      const ts = isBoundaryCluster
        ? new Date(base + 4 * 1000).toISOString()
        : new Date(base + turn * 1000).toISOString()
      out.push({
        id: pad(n),
        turn,
        entryType,
        content,
        timestamp: ts,
      })
      n++
    }
  }
  return out
}

function insert(entries: Synthetic[]): void {
  let idx = 0
  for (const e of entries) {
    db.insert(logsTable)
      .values({
        id: `${ISSUE_ID}-${e.id}`,
        issueId: ISSUE_ID,
        turnIndex: e.turn,
        entryIndex: idx++,
        entryType: e.entryType,
        content: e.content,
        metadata: null,
        timestamp: e.timestamp,
        visible: 1,
      })
      .run()
  }
}

/** Index a timeline by its stable `id` for cross-page comparison. */
function byId(entries: TimelineEntry[]): Map<string, TimelineEntry> {
  const m = new Map<string, TimelineEntry>()
  for (const e of entries) m.set(e.id, e)
  return m
}

describe('PLAN-032: persisted sequence is one namespace across pages', () => {
  beforeEach(async () => {
    const projectId = await createTestProject(`PLAN-032 ${Date.now()}`)
    const created = expectSuccess(await createTestIssue(projectId))
    ISSUE_ID = created.id as string
  })

  it('history pages share the live/full namespace — no collisions, same id same seq, stable order', () => {
    const entries = buildEntries()
    insert(entries)

    // 1. "Live/full" reference — the whole issue on one page. Rows have no
    //    persisted seq yet, so the converter assigns via its deterministic
    //    formula: this is the canonical order the SSE path would have shown.
    const full = getLogsFromDb(ISSUE_ID, { limit: 10_000 })
    const reference = toTimeline(full.entries)
    const refById = byId(reference)

    // 2. Persist the authoritative seq back onto each row (simulating the
    //    pipeline: persist stage + timeline-emit back-fill). Every reference
    //    entry maps to its row by messageId (== row id for our synthetic data).
    for (const e of reference) {
      // `messageId` is written onto the entry at runtime by the converter but
      // is not declared on the local TimelineEntry type (a pre-existing gap).
      const rowId = (e as { messageId?: string }).messageId
      expect(rowId).toBeDefined()
      db.update(logsTable)
        .set({ sequence: e.sequence })
        .where(eq(logsTable.id, rowId!))
        .run()
    }

    // 3. Paginate the SAME data via two non-overlapping turn ranges. Each call
    //    builds a FRESH converter (the historical bug trigger).
    const page1 = toTimeline(getLogsFromDb(ISSUE_ID, { turnIndex: 0, turnIndexEnd: 4 }).entries)
    const page2 = toTimeline(getLogsFromDb(ISSUE_ID, { turnIndex: 5, turnIndexEnd: 9 }).entries)
    const paginated = [...page1, ...page2]

    // (b) Same entry → same seq in history as live/full.
    for (const e of paginated) {
      const ref = refById.get(e.id)
      expect(ref).toBeDefined()
      expect(e.sequence).toBe(ref!.sequence)
    }

    // Pages cover the whole conversation exactly once.
    expect(paginated.length).toBe(reference.length)

    // (a) No two DISTINCT entries collide on sequence across pages.
    const seqToId = new Map<number, string>()
    for (const e of paginated) {
      const seq = e.sequence ?? 0
      const prev = seqToId.get(seq)
      if (prev !== undefined) {
        expect(prev).toBe(e.id) // only the same id may reuse a seq
      }
      seqToId.set(seq, e.id)
    }
    // Distinct ids ⇒ distinct seqs.
    expect(new Set(paginated.map(e => e.sequence)).size).toBe(paginated.length)

    // (c) Global order is stable: sorting the concatenated pages by seq yields
    //     exactly the reference order.
    const sorted = [...paginated].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    expect(sorted.map(e => e.id)).toEqual(reference.map(e => e.id))
  })

  it('old rows with null sequence still render (deterministic fallback, monotonic within page)', () => {
    const entries = buildEntries()
    insert(entries)
    // Intentionally leave `sequence` NULL (pre-PLAN-032 data).

    const page = toTimeline(getLogsFromDb(ISSUE_ID, { turnIndex: 0, turnIndexEnd: 4 }).entries)
    expect(page.length).toBeGreaterThan(0)
    // Strictly increasing within the page — nothing renders out of order.
    for (let i = 1; i < page.length; i++) {
      expect(page[i].sequence!).toBeGreaterThan(page[i - 1].sequence!)
    }
  })

  it('proves the guard bites: WITHOUT persisted seq, fresh-per-page converters collide at the boundary', () => {
    const entries = buildEntries()
    insert(entries)
    // No back-fill — reproduce the legacy fresh-converter-per-page behaviour.

    const page1 = toTimeline(getLogsFromDb(ISSUE_ID, { turnIndex: 0, turnIndexEnd: 4 }).entries)
    const page2 = toTimeline(getLogsFromDb(ISSUE_ID, { turnIndex: 5, turnIndexEnd: 9 }).entries)
    const seqs = new Set([...page1, ...page2].map(e => e.sequence))
    // The boundary cluster shares a timestamp, so page2's fresh converter
    // re-derives sequences that overlap page1 → fewer unique seqs than entries.
    expect(seqs.size).toBeLessThan(page1.length + page2.length)
  })
})
