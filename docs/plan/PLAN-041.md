# PLAN-041 Streaming assistant output + interleaved tool/text timeline (claude-code parity with AoE)

- **status**: completed
- **approvedAt**: 2026-06-08 (user: "一口气做完吧")
- **createdAt**: 2026-06-08
- **relatedTask**: CHAT-013
- **borrowed-from**: AoE structured view (in-place streaming chunk growth + interleaved turn transcript)

## Problem (user)

"bkd 不是流式的,都是憋完一次性吐出来。而且也不像 AoE 一样,工具调用跟 assistant response 是交叉的。"

Two gaps, both real:
1. **No token streaming** — the claude-code assistant reply appears all at once on completion, not incrementally.
2. **No tool/text interleave** — a turn renders as "all assistant text" + "all tool calls" grouped, not text → tool → text → tool in occurrence order (AoE interleaves).

## Investigation (root causes, file:line)

### GAP 1 — no streaming = BACKEND (claude executor only)
- `apps/api/src/engines/executors/claude/normalizer.ts:513-515` — `parseContentBlockDelta()` explicitly `return null`: ALL `content_block_delta` streaming events are dropped. The assistant turn is emitted only as the COMPLETE `assistant-message` (parseAssistant, :174-200), once, after `message_stop`.
- Codex (`codex/normalizer.ts:169-179`) and ACP (`acp/normalizer.ts:94-113`) DO emit `streaming: true` delta entries — so only **claude-code** (the default engine) is non-streaming.
- The FE already supports streaming: `engines/issue/pipeline/timeline-emit.ts:42-47` routes `streaming:true` entries through a streaming buffer; `timeline-converter.ts mergeChunk` accumulates partial chunks by id; `use-chat-messages` has cascading-merge. **The pipeline is ready; the claude normalizer just never sends deltas.**

### GAP 2 — no interleave = FRONTEND grouping
- Backend emits entries in correct sequence order: a turn is `assistant-msg-1[text1, tool_use1]` → `tool_result1` → `assistant-msg-2[text2, tool_use2]` → … so the flat log IS `[text1, tool1, text2, tool2, text3]` with monotonic `sequence` (`parseAssistant` returns text entry then tool-use entries; across messages they interleave).
- `apps/frontend/src/hooks/use-chat-messages.ts` `rebuildMessages` (~:75-350) collects adjacent tool-use entries into a `toolBuffer` (`:208-223`) and merges assistant text across tool boundaries, flushing the whole tool group on the next conversation entry (`:294-350`). Net: `[text1, tool1, text2, tool2, text3]` → `[text(1+2+3) bubble, tool-group{1,2}]` — tools pulled out of their interleaved position.

## Proposal

Make claude-code stream like codex/acp, and render the timeline in true sequence order with tool cards interleaved between assistant text segments.

### P1 — Backend: stream claude-code assistant deltas
- In `claude/normalizer.ts`, implement `parseContentBlockDelta` (and `content_block_start`/`stop`) to emit incremental `assistant-message` entries with `metadata: { streaming: true, messageId }`, content = the delta text, keyed so the FE `mergeChunk` accumulates them into one growing entry (mirror codex's delta shape). On `message_stop` / the final `assistant` event, emit the terminal entry (the existing path) as the authoritative reconciliation so a dropped delta can't corrupt the final text.
- Preserve **content-block ordering**: when a turn's content is `[text, tool_use, text]`, the text deltas of block 1, then the tool_use entry, then text deltas of block 2 must carry increasing `sequence`, so the timeline naturally interleaves (this also feeds GAP 2). Verify the per-entry sequence/turnIndex assignment in the stream pipeline keeps deltas + tool_use in emission order.
- Keep thinking-block streaming consistent (thinking deltas already?) — audit so thinking also streams or stays terminal without breaking ordering.

### P2 — Frontend: interleave tools with assistant text by sequence
- Change `use-chat-messages.ts rebuildMessages` so a tool-use entry does NOT merge across an assistant-text boundary: flush / segment so render order follows `sequence`. Keep the "group consecutive tool calls into one card cluster" UX ONLY for tools that are genuinely adjacent (no assistant/thinking entry between them by sequence); otherwise start a new segment. Result: `text1 → tools → text2 → tools → text3`.
- Ensure the streaming (P1) growing assistant entry renders in place at its sequence position, with later tool cards appearing after it as they stream — not reordered.
- Keep the existing cascading-merge for genuinely consecutive same-type chunks (don't regress PLAN-009 dedup/merge tests).

## Risks
- HIGH-history area (chat ordering: PLAN-007/009/010/034, BUG-009/011, the use-issue-stream invariant + reorder-race tests). Streaming + regrouping must not break sequence invariants → lean hard on the existing vitest suites + add cases for interleave + streaming-then-terminal reconciliation.
- Double-render / flicker: streaming deltas then a terminal complete-message must dedupe by messageId (mergeChunk already does) so the final text doesn't duplicate or flash.
- Tool grouping change must not explode into 1 card per tool when tools ARE parallel/adjacent (keep adjacency grouping).
- Claude SDK delta shape: confirm `content_block_delta` carries `index` (content-block index) so multi-block ordering is correct; partial tool_use input deltas (`input_json_delta`) should NOT be rendered as assistant text.

## Scope
Backend: `executors/claude/normalizer.ts` (delta emission + ordering), maybe `engines/issue/streams/` + `pipeline/timeline-emit.ts` (verify streaming routing for claude). Frontend: `hooks/use-chat-messages.ts` (interleave grouping). Tests: extend `use-issue-stream.*` + `use-chat-messages` + a normalizer test for delta emission. No schema change.

## Alternatives
- Backend block-splitting only (emit assistant text per content-block as separate terminal entries, no token streaming) — fixes interleave but NOT streaming. Rejected: user wants both.
- Frontend-only (synthesize streaming) — impossible; the deltas never reach the client.

## Annotations
- 2026-06-08: Investigated. GAP1 = claude normalizer drops content_block_delta (backend, single function); GAP2 = use-chat-messages tool-buffer regroups across text boundaries (frontend). Codex/ACP already stream. Pipeline supports streaming; only claude-code doesn't emit. Pending `proceed`.
- 2026-06-08: **Implemented (P1+P2), not yet deployed.** P1 backend: claude executor `--include-partial-messages` (in createBaseBuilder → covers spawn + follow-up; NOT the discovery probe); normalizer streams text_delta → `assistant-message{streaming,messageId}` + thinking_delta → `thinking{streaming}`; input_json_delta/signature_delta → null; final assistant/thinking entry flagged `dbOnly` ONLY when that messageId actually streamed (persists full text once, no duplicate live bubble); tool-use entries stay terminal so they keep sequence after the streamed text → natural text→tool→text interleave. New claude-normalizer streaming tests; api tsc 0 net-new (49), claude-normalizer 74 pass, timeline/pipeline 111 pass, 0 net-new full-suite failures. P2 frontend: assistant-text interleave already worked; fixed tool clusters merging/reordering across thinking/system/error boundaries (flush toolBuffer before those) + kept adjacent-tool clustering + cascading same-type merge; 4 new use-chat-messages tests; FE tsc 0, 418 tests pass. N/A container/tmux.
