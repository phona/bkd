---
id: DIFF-001
title: Diff inline comments → send to agent
status: in_progress
priority: P1
owner: claude
created: 2026-06-06
updated: 2026-06-06
plan: PLAN-035
---

# DIFF-001 — Diff inline comments → send to agent

Borrowed from AoE. Annotate diff lines, then batch-send the comments to the
agent as a follow-up. Primary post-hoc steering surface for auto-mode use.
Full design in PLAN-035.

## Feasibility

`@pierre/diffs` (already used by DiffPanel) supports line annotations natively:
`renderHoverUtility` (hover "+"), `lineAnnotations` + `renderAnnotation` (inline
comment box), `selectedLines`. No DOM hacks needed.

## Steps

1. **Foundation (testable, this commit):** a per-issue diff-comments store
   (Zustand + localStorage) and a pure `buildReviewFollowUp(comments)` message
   builder, with unit tests.
2. **UI wiring (needs manual verification on a real diff — no browser here):**
   `renderHoverUtility` → "+" → composer; `lineAnnotations`/`renderAnnotation` →
   inline comment boxes; a "Send to agent (N)" bar that builds the follow-up and
   dispatches via the existing follow-up path; clear-after-send. Mobile parity.

## Verification

Unit tests for store + builder; lint + tsc. Diff interaction verified manually.
