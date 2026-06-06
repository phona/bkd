# PLAN-030 Branch/workspace interaction redesign — visibility + merge-back

- **status**: draft
- **createdAt**: 2026-06-06
- **approvedAt**: (pending)
- **relatedTask**: WT-003 (to be created)
- **depends on**: PLAN-028
- **builds on**: PLAN-025 / WT-001 (base branch + custom branch name — already done)

## Context

User finds bkd's branch/workspace management awkward vs AoE's (which feels
comfortable). Audit (2026-06-06) of the create→work→review→done loop found the loop
is broken in two places. Note: the "readable/custom branch name + choose base
branch" gap is **already closed** by PLAN-025 / WT-001, so this plan does NOT
redo it — only the remaining real gaps.

Remaining gaps:
- Kanban cards show no workspace/branch/status — you can't tell what runs where.
  Info is buried behind a small button in detail and `max-md:hidden` on mobile.
- No "merge back to main / discard" UI — agent's work is stranded on its branch;
  user must leave bkd for `git merge && push`. The loop never closes inside bkd.
- Worktree defaults OFF → issues can silently share a dir and pollute each other.

## Proposal

Three cuts (per DESIGN.md B-3 / B-6 / C-1):
1. **Visibility**: status dot + branch chip (teal `--accent-brand`) on kanban cards
   and detail, glanceable and consistent, **including mobile**.
2. **Close the loop**: merge-back / discard action in the conversation surface so
   landing changes never leaves bkd (B-4: no silent failure on merge conflicts).
3. **Default right**: worktree on by default for git projects (B-2).

## Risks

- Merge-back UI must handle conflicts visibly, not silently.
- Defaulting worktree on changes behavior for existing flows — communicate clearly.

## Scope

`components/kanban/KanbanCard.tsx`, `issue-detail/IssueDetail.tsx`,
`issue-detail/DiffPanel.tsx`, worktree routes/merge endpoint, CreateIssueDialog default.

## Alternatives

Global worktree manager page — deferred; the per-card visibility + in-loop merge
covers the actual daily pain without a new PM-ish surface.

## Annotations

- 2026-06-06: Created. Scoped down after finding WT-001/PLAN-025 already shipped the
  branch-name/base-branch part.
