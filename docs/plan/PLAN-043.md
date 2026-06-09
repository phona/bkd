# PLAN-043 Unify chat on one renderer (AcpTimeline) — delete the legacy claude-code renderer

- **status**: completed
- **approvedAt**: 2026-06-08 (user: "好，起多路subagent弄")
- **createdAt**: 2026-06-08
- **relatedTask**: CHAT-014
- **part-of**: the "chat convergence" program (PLAN-043 single renderer → PLAN-032 single data source → PLAN-031 decompose)

## Problem (user)

"为什么 opencode 跟 claude code 用的 UI 不一样?" → bkd has TWO parallel chat renderers + TWO grouping hooks, routed by engine type. Same root as the chat-bug density: two parallel implementations that diverge, double the bugs, inconsistent UX, and fixes don't transfer (e.g. PLAN-041 interleave landed only in the legacy hook).

## Current state (investigated, file:line)

Routing at `components/issue-detail/SessionMessages.tsx:194`:
```
engineType?.startsWith('acp') → AcpTimeline + use-acp-timeline.ts   (gemini/codex/claude-acp/opencode)
else                          → LegacySessionMessages + use-chat-messages.ts   (claude-code, claude-code-sdk)
```
Both consume the SAME input (`TimelineEntry[]`) and share `ToolGroupMessage` + `LogEntry`. The split is historical (ACP got a fresh renderer instead of reusing the legacy one).

**Feature-parity highlights:**
- **AcpTimeline (use-acp-timeline)** — Virtuoso (`firstItemIndex`/`followOutput`: automatic, reliable scroll-anchor + streaming re-pin, no manual scrollHeight-delta compensation); dedicated `StreamingThinking`/`CompletedThinking` (auto-scroll + collapse); **renders pending/queued messages** (footer + edit); `AcpPlanCard` (styled). Thin layer — delegates segment splitting to the backend TimelineConverter (which claude-code ALSO goes through).
- **Legacy (use-chat-messages)** — `@tanstack/react-virtual` (threshold 80) + MANUAL scroll-anchor (the BUG-009 re-pin + prepend compensation, fragile); **explicit PLAN-041 interleave** (flush tool buffer on thinking/error); renders **error** + **system** messages + **command** `<details>` + **search-jump** (scrollToMessage); does NOT render pending messages.

## Proposal — keep AcpTimeline, port the gaps, delete legacy

**KEEP** `AcpTimeline` + `use-acp-timeline.ts` as the single renderer (Virtuoso scroll is more reliable than Legacy's manual compensation; richer thinking UX; renders pending; backend-aligned thin layer). Route ALL engines (incl. claude-code) through it.

**PORT from Legacy → AcpTimeline** before deleting:
1. **Error-message rendering** (Legacy renders ErrorChatMessage; ACP wraps as generic entry) — add error case.
2. **System-message rendering** with subtype (Legacy renders info/etc.; ACP only renders plan) — add system case.
3. **Search-jump** (Legacy `scrollToMessage`; ACP has none) — add `jumpMessageId` + Virtuoso `scrollToIndex` + focus.
4. **Command message UI** (Legacy expandable `<details>` for status=command) — verify LogEntry handles it.
5. **Interleave verification**: PLAN-041's explicit flush lives in use-chat-messages; AcpTimeline relies on backend pre-segmentation. **Verify claude-code's streamed `[text, tool, text, tool]` interleaves correctly under use-acp-timeline** (it flushes the tool buffer on any non-tool item, so it should) — port/add the PLAN-041 interleave test cases against use-acp-timeline.

**DELETE** after parity: `LegacySessionMessages` + `VirtualMessageList` (SessionMessages.tsx), `use-chat-messages.ts` (+ its test, port cases), `TaskPlanMessage` (use `AcpPlanCard`). SessionMessages becomes a thin wrapper (or AcpTimeline is renamed).

## Scope
Frontend only. `SessionMessages.tsx` (drop routing + delete Legacy), `AcpTimeline.tsx` (+error/system/search/command), `use-acp-timeline.ts` (expose error/system items), tests (port interleave + scroll-anchor + load-older to the acp path). Delete `use-chat-messages.ts`. ~800 lines deleted, ~200 added.

## Risks
- **claude-code entry coverage under use-acp-timeline** — claude-code goes through the same backend converter (segments thinking/assistant) so entries arrive pre-segmented; but verify EVERY claude-code entry type (error/system/command/tool action+result pairing/interleave) renders correctly before deleting Legacy. This is the core risk — it's a hard prerequisite to deletion.
- Virtuoso perf on 500+ item histories (cap MAX_LIVE_LOGS=500) — was conditional (threshold 80) in Legacy; AcpTimeline always virtualizes — verify.
- Search-jump + Virtuoso `scrollToIndex` while items virtualized/unmounted.
- Keep all existing use-chat-messages + invariant + reorder tests' INTENT covered by ported acp tests.

## The "chat convergence" program (the actual root fix for "chat 太多 bug")
Three orthogonal-but-complementary cleanups, recommended order:
1. **PLAN-043 (this) — single renderer.** Biggest immediate win: deletes a whole parallel implementation → UI consistency + half the surface. Lower risk than PLAN-032. Do first.
2. **PLAN-032 — single data source** (persist seq → collapse olderLogs+liveLogs into one array). After PLAN-043, the unified AcpTimeline benefits: drop `byId` dedup, simpler firstItemIndex.
3. **PLAN-031 — decompose the giant components** (ChatBody/use-issue-stream) once there's one renderer + one data source to decompose around.
Together = "three sources of truth + two renderers" → "one source + one renderer + decomposed". Each alone is a band-aid; the program is the cure.

## Alternatives
- Unify on Legacy instead — rejected: Legacy's manual scroll-anchor is the fragile part (BUG-009 history); AcpTimeline's Virtuoso is more reliable + renders pending + backend-aligned.
- Keep both, just sync features — rejected: the divergence IS the problem.

## Annotations
- 2026-06-08: Investigated both renderers + grouping hooks (full parity matrix). Recommend keep AcpTimeline, port error/system/search/command + verify claude-code interleave, delete Legacy + use-chat-messages. Orthogonal to PLAN-032; do first. Pending `proceed`.
- 2026-06-08: **Done (not yet deployed).** Unified on AcpTimeline; SessionMessages is now a thin wrapper (no engineType branch) — ALL engines render through AcpTimeline + use-acp-timeline. Audit finding: `LogEntry` is shared, so error/system already rendered via the generic `entry` path; real gaps were narrower — ported Legacy's noisy-subtype skip (task_progress/stop_hook_summary/task_notification) into use-acp-timeline; ported command user-message pairing (`AcpTimelineCommandItem` + folded `<details>`); added search-jump (VirtuosoHandle scrollToIndex + flash + data-message-id). PLAN-041 interleave verified preserved (flushToolBuffer on any non-tool item; tests prove [a,t1,b,t2,c] interleaved, [a,t1,t2,b] clustered, [t1,think,t2] no-merge). Deleted use-chat-messages.ts + LegacySessionMessages + VirtualMessageList + TaskPlanMessage + their tests (cases ported to use-acp-timeline). Verified: FE tsc 0, 408 tests pass, lint clean. One nuance to eyeball on-device: thinking between two tool bursts attaches to the following burst (existing AcpTimeline convention, not a regression).
