# DOCK-001 Dockable, persistent terminal / diff / file-browser panels

- **status**: closed
- **priority**: P1
- **owner**: (unassigned)
- **createdAt**: 2026-06-06 13:48

## Closure (2026-06-06)

Closed at user request — dockable panels are not wanted. (ID retained per PMA
rules; do not reuse. See PLAN-027 marked rejected.)

## Description

The terminal, file browser, and process manager are overlay drawers mounted
globally in `main.tsx`; closing one destroys its state (the terminal calls
`disposeTerminal()` on close), and the diff panel is page-level state lost on
refresh. Users want these to dock and stay resident (IDE-style) instead of being
reopened every time.

Current state:
- TerminalDrawer / FileBrowserDrawer / ProcessManagerDrawer = overlay drawers
  with duplicated resize logic (4 places) and per-store `clampWidth`.
- FileBrowser already has a dual `isDrawer` mode — the only existing "dock"
  precedent.
- DiffPanel is controlled entirely by ChatArea/page state, no global store.
- No unified docking framework.

Goal: a docking model where terminal / diff / file browser can be pinned as
resident, resizable panels (desktop: dockable split; mobile: tabbed full-screen
switch, AOE-style with `visibility:hidden` to keep the PTY alive), with state
that survives close/reopen.

Acceptance criteria:
- Panels can be docked (resident) or floated (drawer); preference persists.
- Terminal session is NOT destroyed when its panel is hidden/closed.
- Diff panel state persists across refresh.
- Shared resize hook replaces the 4 duplicated implementations.
- Mobile: tabbed full-screen panel switch keeps PTY alive.
- Desktop + mobile parity.

## ActiveForm

Building a unified dockable-panel layout for terminal/diff/file browser

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Highest-risk item (touches layout, 4 stores, multi-panel width contention).
  Do last, on its own branch.
- Reference: AOE ContentSplit / RightPanel / MobileMainPane / MobileRightPanelPicker.
- Related plan: PLAN-027.
