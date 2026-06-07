# PLAN-036 Desktop dock rail + mobile summon panels (terminal / files / diff)

- **status**: draft
- **createdAt**: 2026-06-07
- **approvedAt**: (pending)
- **relatedTask**: DOCK-002 (to be created)
- **supersedes**: PLAN-027 (was rejected "不需要 dock"; user reversed — now wanted)
- **prototype**: `docs/bkd-dock-rail-prototype.html` (approved)

## Context

Terminal, file browser and diff are currently transient: TerminalDrawer destroys
the PTY on close, FileBrowser is a drawer, DiffPanel is page-level state lost on
refresh, and Terminal/FileBrowser are **global** overlay drawers reachable from
any page. The user wants AoE-style **persistent, alive** panels on desktop and a
clean **summon-on-demand** flow on mobile, scoped to the issue-detail page.

Design approved via the interactive prototype.

## Proposal (approved design)

### Desktop — persistent right rail (issue-detail page only)
- A resident right rail beside the chat: tabs **Terminal / Files / Diff**.
- Resizable width (drag left edge); **collapse** to a thin icon strip and expand.
- Hidden tabs stay **mounted/alive** (terminal PTY kept alive; files keep browse
  path; diff keeps state).
- Persist: rail open/collapsed, width, last-active tab (localStorage).
- Default: open, last-tab remembered; first-ever default = Diff.

### Mobile — summon from the ⋯ overflow, full-screen, alive
- No top tab bar. The composer's existing **⋯ "more"** menu gains
  **Terminal / Files / Diff** entries (above the existing items: clear-session,
  dev-view, worktree…).
- Selecting opens a **full-screen overlay** (header + ×). Close = hide, not
  destroy — panels stay mounted/alive.
- **Terminal helper key bar** (AoE-style) docked under the terminal overlay:
  `Esc · Tab · Ctrl · ↑ ↓ ← → · | ~ / -`, horizontally scrollable.
  - **Ctrl** is a sticky modifier: tap = one-shot (applies to next key),
    long-press = lock (until tapped off). Arrows send escape sequences; Esc/Tab
    send their codes; symbols insert literally.

### Removed / kept
- **Remove** the global Terminal drawer + global FileBrowser drawer and their
  top-bar entry points (terminal/files only live in the issue-detail rail/overlay).
- **Keep** ProcessManager (cross-issue) and Notes as global drawers.

### Shared plumbing
- Keep PTY alive when hidden (mirror AoE's `visibility:hidden`); coordinate with
  BUG-004's PTY session lifecycle so hidden ≠ leaked (closing the issue / unmount
  still disposes).
- Promote DiffPanel state into a store so it survives refresh.
- Extract one shared resize hook to replace the ~4 duplicated clampWidth impls.
- A small `dock-store` (zustand) for rail open/width/tab + which mobile overlay is
  open; localStorage-persisted.

## Risks

- Highest blast radius (layout, multi-panel width, PTY lifecycle, mobile keyboard
  vs helper bar). Land incrementally, verify each step. Own the keep-alive ↔
  BUG-004 interaction carefully (don't reintroduce the session leak).
- Mobile helper bar must sit above the soft keyboard (visualViewport-aware).

## Scope

`apps/frontend`: issue-detail layout shell, a dock-store, the right-rail component
(tabs/resize/collapse), mobile overlay host + terminal helper bar, terminal/file/
diff component reuse (mount-always, hide-not-destroy), DiffPanel state store,
shared resize hook; remove global Terminal/FileBrowser drawers + top-bar entries.
No backend change expected (terminal WS + file/diff APIs already exist).

## Phasing

1. dock-store + shared resize hook + persist diff state (no visual change).
2. Desktop right rail (tabs/resize/collapse/keep-alive); remove global term/file
   drawers + entries.
3. Mobile: ⋯ entries + full-screen overlay host + keep-alive.
4. Terminal helper key bar (Esc/Tab/Ctrl-sticky/arrows/symbols) + visualViewport
   positioning.

## Alternatives

Full flexible docking (drag/float/split) — rejected as overkill (B in brainstorm).
Half-step keep-alive only — rejected; user wants the real rail (A).

## Annotations

- 2026-06-07: Brainstormed + approved via prototype. Desktop rail (A), mobile ⋯
  summon (not tabs), AoE terminal helper keys added. Supersedes the rejected
  PLAN-027.
