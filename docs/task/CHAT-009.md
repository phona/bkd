---
id: CHAT-009
title: Chat reliability — single seq-indexed array (persist backend seq + collapse frontend)
status: in_progress
priority: P1
owner: claude
created: 2026-06-08
updated: 2026-06-08
plan: PLAN-032
---

# CHAT-009 — Single seq-indexed array

See [PLAN-032](../plan/PLAN-032.md). Root cause of the chat-ordering bug class:
3 sources of truth + per-page converter restarts seq (pages collide). Fix:
P1 persist a single per-issue sequence authority (DB column + shared by persist & live emit;
toTimeline carries it instead of re-assigning) → P2 collapse frontend olderLogs+liveLogs into
one seq-sorted array (keep byMessageId dedup). P1 is a hard prerequisite for P2.

Status: **proposed — awaiting `proceed`.**
