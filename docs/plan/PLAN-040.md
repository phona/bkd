# PLAN-040 Smooth issue switching — replace remount-on-switch with explicit per-issue resets

- **status**: P1 shipped (P3 dock deferred)
- **createdAt**: 2026-06-08
- **approvedAt**: 2026-06-08 (user: "要。搞完这个一起部署")
- **relatedTask**: CHAT-012
- **borrowed-from**: AoE (in-memory session list; switching is a view-swap, not a teardown)

## Problem

Switching issues feels like a full page reload (blank → spinner → refetch → scroll jump).
Root cause: the chat subtree is force-remounted on every switch via `key={issueId}`, then
its data is refetched with loading placeholders. AoE keeps sessions in memory and just swaps
the view.

## Causes (investigated, file:line)

Full remounts (Tier 1 — the "reload" feel):
- `IssueDetailPage.tsx:131` — `<ChatArea key={issueId}>` remounts the ENTIRE chat subtree.
- `ChatBody.tsx:506` — `<LazySessionMessages key={issueId}>` remounts the message list.
- `ChatArea.tsx:427/436` — `<DockRail/MobileDockOverlay key={issueId}>` remount the dock (PTY dispose+respawn, file browser reset).

Uncached refetch + loading (Tier 2):
- `use-kanban.ts` — `useIssue`/`useIssueChanges`/`useIssueAiChanges`/… have no `placeholderData: keepPreviousData` → `isPending` flash on every switch.
- `use-issue-stream.ts:176-202,534-543` — historical logs refetched; LRU cache caps at 20 issues → blank on cache miss.

Scroll/state resets (Tier 4):
- `ChatBody.tsx:400-429` — `restoredForIssueRef` already keys off issueId via effect (NOT remount) → fine to keep.
- `ChatArea.tsx` — `titleVisible`/`searchOpen`/`editingTitle`/`isCancelling` useState assume remount.

## What each `key` actually guarantees → explicit replacement

1. **`LazySessionMessages key={issueId}`** resets SessionMessages internal scroll refs
   (`initialScrollDone`, `nearBottomRef`, `prevLenRef`, `prevFirstIdRef`, `prevScrollHeightRef`,
   `settleRef`) — SessionMessages.tsx:230-303. Without reset, stale refs cause a scroll jump
   (the comment at ChatBody.tsx:500-504). **Replacement**: pass `issueId` to SessionMessages,
   add a `useLayoutEffect([issueId])` that resets all six refs to initial values BEFORE the
   first scroll effect runs; remove the key.

2. **`DockTerminal` unmount → `disposeTerminal()`** (DockTerminal.tsx:54, BUG-004 + PLAN-023
   slot accounting): on issue change ALL the issue's PTYs must be disposed (MAX_TERMINAL_TABS
   slots, no leak). **Replacement**: keep the dispose-on-issue-change semantics but drive it
   from an explicit `useEffect(() => () => disposeTerminal(), [issueId])` (or a parent effect)
   so the dock CHROME (rail, tabs) doesn't rebuild while the PTY set still resets per issue.
   The file-browser `setIssueContext` (DockRail.tsx:74-82) already runs on an issueId effect →
   keep, drop the remount.

3. **`ChatArea key={issueId}`** resets assorted `useState`. **Replacement**: remove the key;
   reset each on issueId change with `useEffect([issueId])`: `titleVisible→true`,
   `searchOpen→false`, `editingTitle→false`, `titleDraft→''`, `isCancelling→false`, plus any
   other per-issue UI state found in the audit.

4. **`use-issue-stream`** already detects scope change internally (issueId effect at :176-202,
   534-583) — it does NOT need a remount. Verify it cleanly swaps liveLogs/subscription on
   issueId change without the parent remount.

## Phasing

- **P1 — kill ChatArea + LazySessionMessages remount** (biggest win, contained to chat):
  remove the two keys; add the SessionMessages ref-reset effect; audit + reset ChatArea/ChatBody
  per-issue `useState`. Verify against the chat scroll/ordering invariant tests + manual switch.
- **P2 — `placeholderData: keepPreviousData`** on issue/changes/ai-changes queries (and any the
  detail page gates a spinner on). Eliminates the loading flash; old content stays until refresh.
- **P3 — dock keep-alive**: remove DockRail/MobileDockOverlay keys; drive terminal dispose +
  file-browser reset from explicit issueId effects (preserve BUG-004 slot semantics).
- **P4 (optional)** — enlarge the logs LRU / instant-from-cache on revisit to kill blank flashes.

## Risks

- HIGH-history area (BUG-004/005/008/009/011 all live here). The keys were added to fix real
  bugs — the replacement must reproduce each reset exactly, or those regress. Mitigate: map each
  ref/state (done above), lean on existing invariant tests, verify switching manually (scroll
  lands on latest, no jump; terminal doesn't leak slots; search/title reset).
- Terminal slot leak if dispose-on-switch is lost → keep the explicit per-issue dispose.
- keepPreviousData briefly shows the previous issue's title/diff → acceptable (background refresh),
  but ensure the message list is gated on the CURRENT issue's logs (issueId guard) so we never
  render issue A's logs under issue B.

## Scope

Frontend only. `IssueDetailPage.tsx`, `ChatArea.tsx`, `ChatBody.tsx`, `SessionMessages.tsx`,
`use-kanban.ts` (query options), `DockRail.tsx`/`MobileDockOverlay.tsx`/`DockTerminal.tsx`.
No backend/schema. Mobile parity (the dock/overlay world). Lean on existing vitest scroll/ordering tests.

## Alternatives

- Keep remount but show the previous issue's cached logs instantly (skeleton-free) — thinner;
  doesn't fix terminal/dock rebuild or scroll. Rejected vs the proper keep-mounted approach.

## Annotations
- 2026-06-08: Investigated the switch flow; mapped every `key={issueId}` to the reset it
  guarantees + the explicit-effect replacement. Approved ("要。搞完这个一起部署"). Implementing P1→P4,
  deploy together with the queued 0.0.216-lc (PLAN-039).
- 2026-06-08: **P1 shipped (covers P1+P2+P4), not yet deployed** — `useIssueStream` seeds initial
  liveLogs from the LRU cache on MOUNT (instant repaint on remount; new `__resetIssueLogsCache`
  test helper + beforeEach in the 3 stream test files to isolate the now-shared cache);
  `keepPreviousData` on `useIssueChanges`/`useIssueAiChanges` (diff panel no longer flashes);
  `useIssue` seeds from the issues-list cache by id (no full-area loading screen on cold switch —
  correct issue data, not stale-previous, so ChatBody status logic is safe); removed
  `key={issueId}` from `<ChatArea>` (header/title/dock/worktree context + useIssue/useProject stay
  mounted) + explicit per-issue UI reset effect (editingTitle/titleDraft/searchOpen/copied/
  titleVisible). KEPT `key={issueId}` on ChatBody + LazySessionMessages (their intricate
  scroll/stream state still resets cleanly via remount — zero audit-regression risk). Verified:
  FE tsc 0, 414 tests pass (incl. the BUG-004/009/011 invariant + reorder-race guards), lint clean.
- 2026-06-08: **P3 (dock keep-alive) deferred** — removing DockRail/MobileDockOverlay key={issueId}
  needs explicit per-issue terminal dispose + cwd re-arm (BUG-004/PLAN-023 slot accounting) +
  visitedRef reset; higher risk, only matters when the dock is open. Ship P1 first (dominant
  reload cause = chat area), then assess on-device.
