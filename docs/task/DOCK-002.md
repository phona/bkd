---
id: DOCK-002
title: Desktop dock rail + mobile summon panels (terminal / files / diff)
status: in_progress
priority: P1
owner: claude
created: 2026-06-07
updated: 2026-06-07
---

# DOCK-002 — Persistent panels (see PLAN-036)

Implements PLAN-036 (approved via `docs/bkd-dock-rail-prototype.html`).

- Desktop: persistent right rail on the issue-detail page — tabs Terminal/Files/
  Diff, resizable, collapsible to an icon strip, hidden tabs kept alive; persist
  open/width/last-tab.
- Mobile: fold Terminal/Files/Diff into the composer ⋯ menu → full-screen overlay,
  kept alive; terminal helper key bar (Esc/Tab/Ctrl-sticky/arrows/symbols).
- Remove global Terminal + FileBrowser drawers and their top-bar entries; keep
  ProcessManager + Notes global.
- Plumbing: keep PTY alive when hidden (coordinate with BUG-004), DiffPanel state
  store (survive refresh), one shared resize hook, a dock-store.

See PLAN-036 for phasing, risks, scope.
