# PLAN-032 Chat reliability — single seq-indexed array (backend global seq + frontend collapse)

- **status**: draft
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
