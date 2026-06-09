# PLAN-032 Chat reliability — single seq-indexed array (backend global seq + frontend collapse)

- **status**: P1 done (P2 remaining)
- **createdAt**: 2026-06-06
- **approvedAt**: (pending)
- **relatedTask**: CHAT-009 (to be created)
- **continues**: PLAN-007 (partial single-source migration); completes what PLAN-006 deferred

## Context

bkd already moved message stitching to the backend `TimelineConverter` (PLAN-007):
thinking dedup / segment splitting / chunk merging / ordering all happen upstream,
and `use-acp-timeline.ts` (270 lines) is now a thin renderer ("No more thinking dedup
heuristics" — its own comment). That migration is ~80% done.

The residual fragility is the frontend **history+live merge layer** in
`use-issue-stream.ts` (669 lines): two arrays (`liveLogs` + `olderLogs`), `byId`
dedup + `byMessageId` dedup, `logsCache`, and Virtuoso `firstItemIndex` cursor sync.
The most recent chat fix (`a9bbf12`, Virtuoso firstItemIndex on prepend) is exactly
this layer.

Investigation findings (2026-06-06):
- Backend HAS a monotonic, stable per-issue `sequence` (`timeline-converter.ts:154-159`,
  `max(ts*1000, lastSeq+1)`), pinned on same-id upsert (PLAN-010).
- **Blocker**: `toTimeline()` builds a NEW converter per HTTP pagination request
  (`timeline-converter.ts:388-405`), so seq restarts each page — history seq and live
  seq are NOT one namespace. "Single array by seq" is impossible until this is fixed.
- Frontend `byId` dedup is redundant; `byMessageId` (optimistic→canonical) must stay
  (it is independent of seq).

## Proposal

Two phases, small blast radius (NOT the PLAN-006 rewrite):
1. **Backend — one global seq namespace.** Make history pagination + live share a
   single, stable seq per issue (persist seq, or page through a consistent converter).
   Same message → same seq across pages and live. Add an invariant test.
2. **Frontend — collapse to one array.** Drop `olderLogs` + `byId` dedup + `logsCache`
   merge; keep `byMessageId` (optimistic→canonical). History and live both insert by
   seq into one array. Virtuoso `firstItemIndex` logic simplifies.

Rides along: this removes the optimistic→canonical seq race that breaks scroll
anchoring, so it also kills a chunk of the **B-class (scroll/viewport) focus bugs**
(see PLAN-033) — those do not need their own plan.

## Risks

- History seq must truly match live seq — the core correctness risk; pin with tests.
- Keep `byMessageId` dedup + all PLAN-007/010 invariant tests green.
- Large single array (cap is MAX_LIVE_LOGS=500) — verify re-sort/render perf.

## Scope

Backend: `timeline-converter.ts` (`toTimeline` / seq namespace), `routes/issues/logs.ts`,
persistence queries. Frontend: `use-issue-stream.ts` (collapse), `AcpTimeline.tsx` /
`SessionMessages.tsx` (Virtuoso simplification). Leverage existing 15+5 invariant tests.

## Alternatives

PLAN-006's UIMessage big-bang rewrite (~2000 lines, delete 4 files) — rejected then,
still rejected: format migration is not the lever; blast radius too large.

## Annotations

- 2026-06-06: Created from a verified investigation. Frontend collapse is small but
  gated on the backend global-seq fix. Sequenced after PLAN-033 (cheaper focus wins).
- 2026-06-06: Ride-along from AoE sweep — rework bkd's buggy "pending messages" into
  AoE's clean **queued-prompts** UX (type while a turn runs, auto-send when idle).

## 2026-06-08 refresh (re-verified against current code, post PLAN-040/041)

Blocker UNCHANGED and confirmed: `timeline-converter.ts:388` `toTimeline()` builds a
fresh `new TimelineConverter()` per HTTP page → `lastSeq` restarts at 0 each page, so
page-1 and page-2 sequences COLLIDE (not just history-vs-live; pages collide with each
other). `sequence` is computed live, **NOT persisted** (`db/schema.ts issueLogs` has no
sequence column). Live path uses the singleton `liveConverter` (`pipeline/timeline-emit.ts:51`).
PLAN-040 (logsCache mount-seed + `__resetIssueLogsCache`) and PLAN-041 (streaming/interleave)
were ADDITIVE — neither touched the two-array merge or the seq namespace. So PLAN-032 is
still the open architectural debt.

Current 3 sources of truth that must stay in sync (the bug surface):
1. backend **live** seq (singleton liveConverter, accumulates per issue),
2. backend **batch** seq (fresh converter per /logs page — restarts → collides),
3. frontend merge of `liveLogs` + `olderLogs` (+ logsCache) deduped by `byId` + `byMessageId`,
   sorted by `compareTimeline` (seq, id tiebreak) — unstable when seqs collide.

### Concrete migration (refreshed)

**P1 Backend — one persisted per-issue sequence authority (the hard + essential part).**
- Add `sequence` integer column to `issueLogs` (`db/schema.ts` + drizzle migration; index `(issueId, sequence)`).
- Establish a SINGLE per-issue seq authority both the persist stage AND the live-emit stage read,
  so the row written to `issue_logs` carries the SAME seq the SSE `timeline-entry` emits. Key
  implementation detail / risk: persist runs at pipeline order 10, live-emit/converter at order 90 —
  the seq authority must assign BEFORE persist (or persist back-fills the converter's seq). Rehydrate
  the per-issue counter from `max(sequence)` on startup/reconcile so it survives restarts.
- `toTimeline()` for history: stop RE-ASSIGNING seq; carry the persisted `sequence` through (the
  converter still does chunk/thinking merge for display, but seq comes from the DB). → pages + live
  share one namespace; same entry = same seq everywhere.
- New invariant test: paginate a long issue → assert no seq collision across pages + history seq
  matches live seq for the same entry (fills the gap in `timeline-converter.invariants.test.ts`).

**P2 Frontend — collapse to one array (only after P1 lands).**
- Drop `olderLogs`/`olderLogsRef`; insert history + live into ONE array by seq. Keep `byMessageId`
  (optimistic→canonical, seq-independent — removing it regresses PLAN-010/CHAT-008). Keep `byId`
  for same-slice double-fetch safety. Simplify the merge `useMemo`.
- Scroll-anchor (prepend compensation in SessionMessages) STAYS (prepends still grow scrollHeight) —
  just simpler with one array. Lean on use-issue-stream.invariants + reorder-races + use-chat-messages
  tests (all green today) + the new pagination test.

### Biggest correctness risk
History seq MUST equal live seq for the same entry. Without the persisted single-authority seq (P1),
collapsing the frontend exposes visible reordering on every /logs refresh. So P1 is a hard prerequisite;
P2 must not ship before P1 + its invariant test are green.

### Status
- 2026-06-08: Investigation refreshed + migration made concrete. Pending `proceed` to implement P1→P2.
- 2026-06-08: **P1 (backend) DONE (not yet deployed).** `issues_logs.sequence` column + migration 0033 + index (issueId,sequence). Seq authority = the `liveConverter` (option a — only it knows segment boundaries): emit stage back-writes the produced entry's seq to the DB row by messageId for passthrough/non-streamed; persist stage reads `currentSegmentSequence` for dbOnly streamed finals so history==live. `rowToEntry` carries persisted seq; converter `assignSequence` reuses a preset seq verbatim (still bumps lastSeq); `getMaxSequence` rehydrates on first touch (survives restart); null-seq old rows fall back to the deterministic formula. New `timeline-pagination-seq.test.ts` (3/3, incl. negative control proving collisions without persisted seq + null fallback); converter invariants 26/26 green; api tsc 0 net-new; no new full-suite regressions. **Risk flagged for P2**: history==live for dbOnly streamed content relies on the live buffer being open at flush — needs a real-engine ACP soak before P2. **P2 (frontend collapse to one array) REMAINS** — do after on-device verification of P1.
