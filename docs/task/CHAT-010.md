---
id: CHAT-010
title: Chat input focus management
status: in_progress
priority: P1
owner: claude
created: 2026-06-06
updated: 2026-06-06
plan: PLAN-033
---

# CHAT-010 — Chat input focus management

## Goal

Fix the open A-class focus bugs (full design in PLAN-033):

- **[P0]** Composer loses focus after send → caret gone, mobile keyboard dismisses.
- **[P1]** Search bar does not return focus to the composer on close.
- **[P1]** Mention picker does not refocus the composer on cancel.

## Scope

- `handleSend`: refocus the composer after send (success + failure), same-issue guarded.
- `handleMentionSelect`: refocus the composer when the picker is cancelled.
- `ChatSearchBar` close: return focus to the composer.

Deferred to PLAN-031: replace `RoleMentionPicker`'s global `window` keydown listener
with textarea-scoped handling.

## Verification

- `bun --filter @bkd/frontend lint` + typecheck.
- Manual: desktop 1280 + mobile 375 — caret stays after send / keyboard not dismissed;
  Cmd+F → Esc returns to composer; @mention cancel returns to composer.
