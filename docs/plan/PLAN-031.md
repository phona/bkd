# PLAN-031 Decompose giant components per DESIGN.md C

- **status**: draft
- **createdAt**: 2026-06-06
- **approvedAt**: (pending)
- **relatedTask**: UI-003 (to be created)
- **depends on**: PLAN-028

## Context

DESIGN.md pillar C sets structure discipline. Audit (2026-06-06) shows it is widely
violated and this is a top bug-hotspot:
- Oversized files: `AppSettingsDialog.tsx` 1718, `ChatInput.tsx` 1675,
  `ToolItems.tsx` 989, `DiffPanel.tsx` 836, `LogEntry.tsx` 822, `ChatBody.tsx` 736,
  `CreateIssueDialog.tsx` 650.
- Homeless components in `components/` root (`AppSettingsDialog`,
  `ProjectSettingsDialog`) — belong in `settings/`.
- `issue-detail/` is a mega-folder (27 files / 9531 lines) mixing several features.
- 13 Zustand stores, with mergeable ones (chat-filter / chat-search / scroll-position).

## Proposal

Enforce DESIGN.md C incrementally:
1. ~300-line soft ceiling: split the largest offenders (start with ChatInput →
   input / attachments / slash-commands / model-select / send bar).
2. One-way layer deps (`ui/` → area → `pages/`); areas don't import each other.
3. Home every component (move root dialogs into `settings/`).
4. Container/presentation separation.
5. Consolidate stores where they fragment one concern.

## Risks

- Refactor-only; high regression surface in the most bug-prone area. Lean on existing
  chat invariant tests; split one component per change, verify each.

## Scope

`components/issue-detail/*` (largest first), root dialogs → `settings/`, `stores/*`.

## Alternatives

Big-bang rewrite — rejected; incremental splits with test coverage are safer.

## Annotations

- 2026-06-06: Created. Lowest sequencing priority; do after constitution + the
  user-facing wins (029/030).
- 2026-06-06: Ride-along from AoE sweep — when splitting ChatInput, adopt AoE's
  **composer shape** (clean bar, progressive disclosure) and add an **@file picker**
  for context; ToolItems split should use a **kind→component registry** (from PLAN-034
  cross-ref).
