---
id: CHAT-012
title: Smooth issue switching — replace remount-on-switch with explicit per-issue resets
status: in_progress
priority: P1
owner: claude
created: 2026-06-08
updated: 2026-06-08
plan: PLAN-040
---

# CHAT-012 — Smooth issue switching

See [PLAN-040](../plan/PLAN-040.md). Replace the `key={issueId}` full-remount pattern
(ChatArea / LazySessionMessages / DockRail) with explicit per-issue resets + keepPreviousData,
so switching feels like AoE's in-memory view-swap instead of a reload. Must NOT regress
BUG-004/005/008/009/011 (scroll anchoring + terminal slot accounting).

P1 chat remount · P2 keepPreviousData · P3 dock keep-alive · P4 logs cache.
