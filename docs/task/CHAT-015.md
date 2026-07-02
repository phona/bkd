---
id: CHAT-015
title: Complete chat UI overhaul — streamdown rendering, performance, a11y, and error handling
status: in_progress
priority: P1
owner: claude
created: 2026-07-01
updated: 2026-07-01
plan: PLAN-046
---

# CHAT-015 — Complete chat UI overhaul

See [PLAN-046](../plan/PLAN-046.md). Redesign the chat UI for fluent streaming, accessibility, error handling, and mobile UX, inspired by `slopus/happy`.

Covers:
- Replace `react-markdown` with `streamdown` for incremental streaming Markdown rendering.
- Stop full timeline rebuild on every chunk (patch tail only).
- Fix orphan thinking placement and redesign the thinking shell.
- Redesign user/assistant bubbles and tool-call cards.
- Add ARIA roles/labels, focus trap, and keyboard navigation.
- Improve error handling (persistent banners, retry, upload errors).
- Mobile input fixes and scroll-to-bottom polish.

Status: **in progress**.
