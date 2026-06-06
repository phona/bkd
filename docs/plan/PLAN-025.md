# PLAN-025 Worktree base branch and custom branch name

- **status**: completed
- **createdAt**: 2026-06-06 13:48
- **approvedAt**: 2026-06-06 14:40
- **relatedTask**: WT-001

> Decision (2026-06-06): FULL scope — base branch + custom branch name. Stored on
> the issue (DB migration), since worktrees are created at execute time from
> `issue.useWorktree`. Deploy will be a graceful-drain restart (new migration),
> not a hot-reload. User accepted.

## Context

- `createWorktree()` (`apps/api/src/engines/issue/utils/worktree.ts`):
  - branch name hardcoded `bkd/${issueId}` (line 99)
  - `resolveStartPoint()` (lines 48-81) auto-resolves base: origin/HEAD →
    origin/main → master → release → develop → local equivalents → HEAD
  - signature already supports optional `startPointRef?` (line ~92)
- `execute.ts:74-76` calls `createWorktree(baseDir, projectId, issueId)` with NO
  start point — always default.
- `services/fork-dependent.ts:96-97` DOES pass a `headRef` start point (proves
  the param works end-to-end).
- `executeIssueSchema` (`routes/issues/_shared.ts:77-88`) has no branch fields.
- Git branch listing available under `/api/git/*`.

## Proposal

1. Backend: extend `executeIssueSchema` with optional `baseBranch?: string` and
   `branchName?: string`; thread into `createWorktree` (custom name overrides the
   `bkd/{id}` default; base overrides `resolveStartPoint`). Validate branch names.
2. Frontend: collapsed "Advanced" section in the create/execute UI:
   - base branch picker sourced from `/api/git` branches
   - optional branch-name input (placeholder = `bkd/{id}`)
   Keep both optional and hidden by default to preserve the zero-config flow.
3. Wire through `kanban-api.ts` + `use-kanban.ts`; add i18n keys (en + zh).
4. Mobile + desktop parity for the advanced controls.

Open decision (resolve before implementing): persist chosen base/branch per issue
(new DB columns) vs. run-time parameter only. Default lean: run-time only first.

## Risks

- Invalid/ambiguous base branch refs — validate and surface clear errors.
- Custom branch name collisions with existing branches — handle gracefully.
- Must not regress the default path (no advanced input → identical to today).

## Scope

- `apps/api`: worktree util, execute orchestration, issues schema, git route if
  needed.
- `apps/frontend`: create/execute dialog, api client, hook, i18n.
- Possibly `packages/shared` types.

## Alternatives

- Lightweight variant: base-branch picker only (no custom name) — ~80% of the
  value at lower cost. Decide at approval.

## Annotations

(none yet)
