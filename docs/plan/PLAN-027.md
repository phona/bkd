# PLAN-027 Dockable, persistent panels (terminal / diff / file browser)

- **status**: rejected
- **createdAt**: 2026-06-06 13:48
- **approvedAt**: (rejected)
- **relatedTask**: DOCK-001

## Context

- Global overlay drawers mounted in `apps/frontend/src/main.tsx:439-442`
  (Terminal, FileBrowser, ProcessManager, Notes), lazy-mounted on `isOpen`.
- TerminalDrawer destroys the session on close (`disposeTerminal()`,
  `components/terminal/TerminalDrawer.tsx:120-122`).
- FileBrowser has a dual `isDrawer` mode (`stores/file-browser-store.ts`) — the
  only existing dock precedent; it also caches browse path per context.
- DiffPanel is page-level state (`pages/IssueDetailPage.tsx:33-34`,
  `components/issue-detail/ChatArea.tsx:408-452`), lost on refresh.
- Resize logic duplicated in 4 places (FileBrowserDrawer, FileBrowserPanel,
  DiffPanel, KanbanPage); each store re-implements `clampWidth`.
- Width contention managed manually with `MIN_CHAT_WIDTH` constraints.

## Proposal

(High-level; detail during Phase 2.)

1. Extract a shared resize hook/component to replace the 4 duplicates.
2. Introduce a docking layout model: each panel can be `docked` (resident split)
   or `floating` (drawer); persist the preference (localStorage).
3. Stop destroying the terminal session when its panel is hidden — keep the PTY
   alive (mirror AOE's `visibility:hidden` mobile technique).
4. Promote DiffPanel state into a store so it survives refresh.
5. Mobile: tabbed full-screen panel switch (AOE `MobileMainPane` +
   `MobileRightPanelPicker` pattern) that keeps hidden panels mounted/alive.

## Risks

- Highest blast radius: layout, 4 stores, multi-panel width contention, mobile
  vs desktop. High regression risk — own branch, land last.
- Keeping PTY alive interacts with BUG-004's session lifecycle — coordinate.

## Scope

- `apps/frontend`: layout shell, terminal/file-browser/diff components and their
  stores, a new docking/layout store, shared resize hook.

## Alternatives

- Half-step variant: only (a) keep terminal session alive on close + (b) persist
  diff state — much cheaper, defers the full docking framework. Decide at
  approval.

## Annotations

- 2026-06-06: Rejected at user request ("不需要 dock"). Dockable/persistent
  panels are out of scope. ID retained per PMA rules (no reuse).
