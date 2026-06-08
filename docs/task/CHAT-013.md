---
id: CHAT-013
title: Streaming assistant output + interleaved tool/text timeline (claude-code)
status: completed
priority: P1
owner: claude
created: 2026-06-08
updated: 2026-06-08
plan: PLAN-041
---

# CHAT-013 — Streaming + interleaved tool/text (claude-code)

See [PLAN-041](../plan/PLAN-041.md). Two gaps vs AoE:
1. claude-code doesn't stream (normalizer drops content_block_delta) — backend.
2. tool calls not interleaved with assistant text (use-chat-messages regroups) — frontend.

P1 backend: emit claude streaming deltas (like codex/acp). P2 frontend: interleave tools by sequence.
Status: **proposed — awaiting `proceed`.**
