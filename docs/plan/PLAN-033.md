# PLAN-033 Chat input focus management

- **status**: draft
- **createdAt**: 2026-06-06
- **approvedAt**: (pending)
- **relatedTask**: CHAT-010 (to be created)

## Context

Focus is the heavier chat hotspot: A-class (keyboard/input focus) has ~26 fixes vs
~18 for B-class (scroll/viewport). B-class is largely improved and rides along with
PLAN-032; the A-class items below are mostly **open bugs**, cheap, and independent of
any other plan — the best immediate-relief work.

Findings (2026-06-06):
- **[P0] No focus restore after send** (`ChatInput.tsx:398-499`): `handleSend` neither
  refocuses on success nor on failure → caret lost, mobile soft-keyboard dismisses.
- **[P1] Search bar does not return focus on close** (`ChatSearchBar.tsx:40-51`):
  Cmd/Ctrl+F → Esc leaves focus stranded.
- **[P1] Mention picker focus trap** (`RoleMentionPicker.tsx:38-62`,
  `ChatInput.tsx:282-308`): global `window` keydown listener; no explicit refocus of
  the textarea on select/close.

## Proposal

- `handleSend` success + failure paths call `textareaRef.current?.focus()` (respect a
  mobile heuristic if it causes keyboard thrash).
- Search bar `onClose` returns focus to the chat textarea.
- Mention picker returns focus to the textarea on select/close; prefer container-scoped
  key handling over a global `window` listener where feasible.

## Risks

- Auto-refocus on mobile can re-open the keyboard unexpectedly — gate/verify on a phone.
- Keep existing input behavior (slash/mention/attachments) intact.

## Scope

`ChatInput.tsx`, `ChatSearchBar.tsx`, `RoleMentionPicker.tsx`. Small. Natural to fold
remaining A-class cleanup into PLAN-031 (ChatInput split) later.

## Alternatives

Defer all focus work into PLAN-031 — rejected; the P0 send-refocus is a few lines and
worth shipping immediately rather than waiting on the larger split.

## Annotations

- 2026-06-06: Created. Lowest-dependency, highest-immediate-ROI chat work; do first.
