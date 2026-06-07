# PLAN-034 Chat message rendering robustness

- **status**: completed
- **createdAt**: 2026-06-06
- **approvedAt**: 2026-06-06
- **relatedTask**: CHAT-011

## Context

Of the three chat problem areas (merge layer / focus / rendering), **rendering is the
healthiest**. Memo guards are largely in place — `LogEntry`, `ToolGroupMessage`, and
thinking blocks all use `memo` + structural equality (PLAN-007 `05ec320`, plus
`a9bbf12`). PLAN-006's tab-freeze root cause (#8, whole-timeline re-render on each
stream chunk) is solved. Markdown raw-copy regression is fixed (Copy → `writeText`).

Recurring-fix distribution: streaming/content-correctness 8 (most) > markdown/code 5 >
tool cards 4 > memo/perf 3 — but most are historical and converged. Two real
residuals remain.

## Proposal

1. **Async load fault tolerance (the real win).** Shiki code blocks and diffs load
   lazily and **fail silently on a network hiccup → "the code block vanished"**
   (`MarkdownContent.tsx:71-99`, ShikiCodeBlock/ShikiUnifiedDiff/ShikiPatchDiff). Add
   retry with backoff + a visible fallback (`<pre>` raw) instead of empty.
2. **Oversized-content guards.** Cap/scroll extremely long messages and large diffs so
   a >100KB blob can't blow up layout or react-markdown.
3. **(micro) MarkdownContent inline re-render guard** for path-chip rendering
   (`renderInlineTag` closure rebuild).

## Risks

- Retry must not loop forever or thrash; cap attempts, cancel on unmount.
- Fallback `<pre>` must still be readable (mobile scroll).

## Scope

`MarkdownContent.tsx`, `CodeRenderers.tsx`, ShikiCodeBlock + diff renderers,
`lib/shiki.ts`. Narrow.

## Out of scope / cross-refs

- **ToolItems 989-line conditional → kind→component registry**: a maintainability
  refactor that belongs with **PLAN-031** (decompose giant components), not here.
- Orthogonal to PLAN-032 (merge layer) and PLAN-033 (focus).

## Alternatives

Do nothing — rendering mostly works; rejected only because the silent async-load
failure is a recurring "code disappeared" complaint worth a small fix.

## Annotations

- 2026-06-06: Created from a verified investigation. Scoped narrow because memo/perf
  and content-correctness are already largely handled by PLAN-007.
