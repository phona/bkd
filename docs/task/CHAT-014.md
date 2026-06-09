---
id: CHAT-014
title: Unify chat on one renderer (AcpTimeline) — delete legacy claude-code renderer
status: completed
priority: P1
owner: claude
created: 2026-06-08
updated: 2026-06-08
plan: PLAN-043
---

# CHAT-014 — Single chat renderer

See [PLAN-043](../plan/PLAN-043.md). Two renderers (AcpTimeline vs LegacySessionMessages) +
two grouping hooks routed by engine type. Keep AcpTimeline + use-acp-timeline (Virtuoso,
reliable scroll, renders pending, backend-aligned); port error/system/search/command +
verify claude-code interleave; route ALL engines through it; delete LegacySessionMessages +
use-chat-messages. First step of the chat-convergence program (PLAN-043 → PLAN-032 → PLAN-031).

Status: **proposed — awaiting `proceed`.**
