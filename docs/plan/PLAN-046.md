# PLAN-046 Complete chat UI overhaul — streamdown rendering, performance, a11y, and error handling

- **status**: approved / implementing
- **approvedAt**: 2026-07-01 (user: "proceed")
- **createdAt**: 2026-07-01
- **relatedTask**: CHAT-015

## Problem (user)

The chat UI feels ugly and sluggish. Messages flicker while streaming, the last thinking block can render below the answer, tool cards are noisy, and there are gaps in accessibility/error handling. The user wants a `slopus/happy`-style fluent chat experience.

## Current state (investigated)

- `MarkdownContent.tsx` uses `react-markdown` + `remark-gfm`, which re-parses the whole message on every SSE chunk.
- `useAcpTimeline` rebuilds the entire timeline array on every chunk.
- `AcpTimeline` renders `thinking` attached above entries, but orphan trailing `thinking` rows flush as standalone items at the bottom.
- `CompletedThinking` / `StreamingThinking` use a violet `<pre>` shell.
- `ToolGroupMessage` / `ToolItems.tsx` have dense, unstyled cards.
- `ThinkingHover` re-renders every 500 ms via `setInterval`.
- `ShikiCodeBlock` highlights the full block from scratch each update.
- `ChatBody` / `ChatInput` lack ARIA labels, command-menu roles, textarea label, and focus trapping in drawers.
- Session failures, `loadOlderLogs` errors, and upload errors show only transient toasts.
- No scroll-to-bottom affordance or reduced-motion support.

## Proposal — four-phase overhaul

### Phase 1: Streaming Markdown + visual refresh
- Add `streamdown`, `@streamdown/code`, `@streamdown/mermaid` to `apps/frontend`.
- Configure Tailwind v4 `@source` directives for `streamdown` and plugins.
- Replace `MarkdownContent` implementation with `Streamdown`, preserving path-chip behavior via component overrides.
- Redesign `LogEntry` user/assistant bubbles to match the Happy-style prototype.
- Update `AssistantMessage` styling so assistant text has clean typography and no heavy bubble.
- Verify Mermaid and diff rendering still work outside `streamdown`.

### Phase 2: Performance
- Refactor `useAcpTimeline` to patch only the tail item instead of calling `rebuildAcpTimeline` on every log change.
- Keep historical item references stable.
- Wrap non-urgent updates in `React.startTransition`.
- Memoize / key `ShikiCodeBlock` per `messageId + blockIndex`.
- Replace `ThinkingHover` interval with CSS animation.

### Phase 3: Thinking placement + shell
- In `useAcpTimeline`, attach trailing `thinking` to the previous assistant/tool entry instead of emitting a standalone `thinking` item.
- Move thinking rendering inside the assistant message component.
- Redesign thinking as a collapsible block above the answer, default-open while streaming, labeled "Thinking…" / "Thought process".
- Render thinking body with `Streamdown` (or formatted prose) instead of raw `<pre>`.

### Phase 4: Tool cards, a11y, errors, mobile polish
- Redesign `ToolGroupMessage` / `ToolItems.tsx` to compact rounded cards with status icons, summary, and expandable I/O.
- Add `aria-label` to scroll buttons and icon buttons.
- Add proper `<label>` for the chat textarea.
- Add ARIA `listbox`/`option` roles and keyboard navigation to the inline command menu.
- Trap focus inside Terminal/FileBrowser/ProcessManager/Notes drawers.
- Replace transient upload/session errors with persistent banners + retry/remove actions.
- Show `loadOlderLogs` errors in the UI.
- Add a scroll-to-bottom button and reduced-motion support.
- Fix `SessionMessages.tsx` `key={idx}` for todo items.

## Scope

Frontend only. Primary files:
- `apps/frontend/src/components/issue-detail/MarkdownContent.tsx`
- `apps/frontend/src/components/issue-detail/LogEntry.tsx`
- `apps/frontend/src/components/issue-detail/AcpTimeline.tsx`
- `apps/frontend/src/components/issue-detail/ToolItems.tsx`
- `apps/frontend/src/hooks/use-acp-timeline.ts`
- `apps/frontend/src/components/issue-detail/ChatInput.tsx`
- `apps/frontend/src/components/issue-detail/ChatBody.tsx`
- `apps/frontend/src/components/issue-detail/ThinkingHover.tsx`
- `apps/frontend/src/components/issue-detail/SessionMessages.tsx`
- `apps/frontend/src/index.css` or global stylesheet
- `apps/frontend/package.json`

## Risks

- `streamdown` + plugins increase bundle size; must measure build output.
- Path-chip logic needs a custom `streamdown` override or inline-text handling.
- `@pierre/diffs/react` diff panels must remain first-class components outside `streamdown`.
- Tailwind v4 must scan `streamdown` JS files for plugin classes.
- i18n strings for new labels must be added to `en.json` and `zh.json`.
- Tests must be updated/added for `useAcpTimeline` tail-only behavior and component rendering.

## Verification

- `bun run lint` clean.
- `bun run test:frontend` passes.
- `bun run build` succeeds and bundle size is acceptable.
- Manual checks: streaming response, thinking collapse, tool cards, command palette keyboard nav, focus trap, error banners, scroll-to-bottom.

## Alternatives

- Keep `react-markdown` and optimize around it — rejected because it is not designed for streaming and the UX will remain flickery.
- Split into separate tasks — rejected in favor of one coordinated chat UI sprint.

## Annotations

- 2026-07-01: Prototype approved. Created task CHAT-015 and plan PLAN-046. Starting Phase 1.
