---
id: CHAT-016
title: Collapse completed thinking blocks by default
status: completed
priority: P2
owner: claude
created: 2026-07-03
updated: 2026-07-03
---

# CHAT-016 — Collapse completed thinking blocks by default

## Goal

Reduce visual noise so the assistant response is immediately readable. Completed
thinking/thought blocks should be collapsed by default and expandable on click.

## Change

- `ThinkingShell` now initializes `isOpen` from the `isStreaming` prop: open
  while reasoning is streaming, collapsed once it completes.
- Updated `AcpTimeline.test.tsx` to assert the collapsed-by-default behavior and
  expand the block before checking its content.

## Verification

- `AcpTimeline.test.tsx` passes.
- `use-acp-timeline.test.tsx` passes.
