# PLAN-038 Worktree lifecycle — explicit completion, tracked state, no silent ops

- **status**: implementing
- **createdAt**: 2026-06-08
- **approvedAt**: 2026-06-08 (user: "这个可以")
- **relatedTask**: WS-002 (to be created)
- **borrowed-from**: AoE (worktree life = session life; cleanup only on explicit delete; dirty-check, no merge/pushed heuristics)
- **prototype**: `docs/bkd-worktree-lifecycle-prototype.html` (served at `/worktree-lifecycle-prototype.html`)

## Problem (why "感觉怪怪的")

Today the worktree lifecycle is NOT tied coherently to the issue lifecycle:

- **Creation** is lazy + scattered across 4 call sites (`execute.ts`, `lifecycle/spawn.ts` ×2, `restart.ts`, `fork.ts`); the worktree appears on first run, not at issue creation.
- **Cleanup** has three uncoordinated paths:
  1. `cron/actions/builtins/worktree-cleanup.ts` — runs every 30 min + on startup (`defaultCron '0 */30 * * * *'`, `runOnStartup`), BUT gated by `worktree:autoCleanup` setting which is **OFF by default** → by default nothing is ever cleaned. When on, it only removes worktrees for issues that are `status='done'` AND done ≥ 1 day (`DONE_AGE_MS`). Issues that never reach `done` are never cleaned even with auto-cleanup on.
  2. Explicit delete dialog (`routes/issues/delete.ts`) — checkboxes `deleteWorktree / forceDelete / deleteBranch`; dirty-check refuses unless force. (AoE-aligned, good.)
  3. Nothing on settle (worktrees deliberately kept for follow-up reuse — `lifecycle/settle.ts`).
- **`removeWorktree`** deletes only the worktree dir, **never the branch** → branches `bkd/...` accumulate forever (only the delete dialog's "delete branch" removes them).
- **Merge ≠ cleanup**: after "Merge to base" the worktree + branch remain as dead weight.
- **Fallback hides state**: if creation fails, `useWorktree=true` but no worktree on disk → UI silently shows the main repo.
- **Multi-project (PLAN-037)**: the delete dialog only handles the primary worktree; linked-repo worktrees are not cleaned (PLAN-037 P3).

Root cause distilled (user): **"说到底就是界定一个 issue 怎么算完成"** — and "完成" should be an explicit user action, not inferred from status / time / merge state. The earlier "merged-only" heuristic was rejected because work can land via PR (remote) or be just marked done — "is it merged into local base" is unreliable and over-complex. AoE sidesteps all of it: worktree life = session life; cleanup only at explicit delete; safety = dirty-check.

## How AoE does it (reference)

- **No auto/periodic worktree cleanup** at all.
- Cleanup happens only when a session is deleted, via a dialog: `delete_worktree / force_delete / delete_branch`.
- Safety = **dirty-check only** (`dirty_worktree_message`): refuse to remove a dirty worktree unless `force_delete`. No merged/pushed reasoning.
- `prune_empty_parent_dirs` removes empty wrapper dirs after removal (empty-only, never `remove_dir_all`).

## Decisions (user, 2026-06-08)

1. **"完成" = explicit user action**, never inferred. The kanban `done` status is a board position; it does **not** auto-touch the worktree.
2. **Two prompt moments** offer (never auto) cleanup: (a) issue → `done`, (b) `Merge to base` success. "问用户要不要清理,这样比默默清理要好得多。"
3. **Explicit tracked state on the issue** — "需要标记 worktree 已经删除的状态,不要隐式操作." A `worktreeState` field, **visible as a badge**: `none | active | cleaned`. Every transition is surfaced/logged; nothing happens behind the scenes.
4. **Cleanup keeps the branch** (so it can be re-pulled); only the **delete-issue** dialog deletes the branch (it's destroying the issue anyway).
5. **State is reversible**: if a `cleaned` issue is moved back to `working/review` OR re-executed, **prompt to re-create** ("重新拉分支") — fetch + checkout/attach, then flip back to `active`. Not silent.
6. **Safety = dirty-check only** (AoE). No merged/pushed/PR heuristics.
7. **Smart cron downgraded** to orphan-only: clean worktrees whose issue was hard-deleted (and prune empty wrapper dirs). Drop the "done ≥ 1 day" auto-delete.
8. **Linked repos (PLAN-037 P3) folded in**: cleanup / re-create / delete all iterate linked repos; the diff endpoint accepts any linked project.

## worktreeState model

`issues.worktreeState`: `'none' | 'active' | 'cleaned'` (default `'none'`).

| transition | trigger | action | surfaced as |
|---|---|---|---|
| `none → active` | first execute/spawn/restart/fork creates the worktree | createWorktree (existing) | chat note "已创建 worktree on <branch>" |
| `active → cleaned` | user confirms cleanup (done-prompt / merge-prompt / "清理 worktree" button) | removeWorktree (dirty-check, force optional); **branch kept** | log "已清理 worktree(分支保留)→ cleaned" |
| `cleaned → active` | user confirms re-create (moved back to working/review, or re-execute) | fetch + checkout/attach existing branch, else from base | log "已重建 worktree on <branch>" |
| any → (row gone) | issue hard-deleted | orphan cron prunes dir + empty parents | (cron log) |

Creation-failure fallback also sets an explicit signal (not silent): keep `worktreeState` honest (`none`) + an existing diagnostic so the UI never claims a worktree that isn't there.

## Scope

### Backend
- `db/schema.ts` + migration (drizzle-generate, never hand-write): add `issues.worktreeState` (text, default `'none'`). Backfill: issues with a worktree dir on disk → `active`, else keep `none`.
- New "clean worktree" action on an issue (keep issue, remove worktree, keep branch, dirty-check + force): `POST /api/projects/:projectId/issues/:id/worktree/clean`. Sets `worktreeState='cleaned'`.
- New "re-create worktree" path: `POST …/worktree/recreate` (fetch + attach/checkout). Sets `active`. Also auto-invoked (with the same explicit logging) when a `cleaned` issue is executed.
- Wire the prompt-cleanup into status→done and merge-success responses (the API returns a "offerCleanup" hint; the actual cleanup is the explicit call above — server never auto-removes).
- Downgrade `cron/actions/builtins/worktree-cleanup.ts` to **orphan-only** (issue hard-deleted); keep `prune_empty_parent_dirs` behavior; drop done-age auto-delete. Keep `worktree:autoCleanup` setting meaning "auto-prune orphans" (decide default — recommend ON since orphans are 100% safe).
- PLAN-037 P3: changes/diff endpoint accepts any linked project + resolves that repo's worktree root; cleanup/recreate/delete iterate linked repos.

### Frontend
- `worktreeState` badge (`active` / `cleaned`) on issue detail + card, visible everywhere.
- Cleanup confirm dialog (dirty warning + force option), reused by: done-drag prompt, merge-success prompt, "清理 worktree" button.
- Re-create confirm dialog when reopening/re-executing a `cleaned` issue.
- Surface every transition in chat as a留痕 note.
- i18n en+zh; mobile parity (per CLAUDE.md hard constraint).

## Phasing

- **P1 (backend core)** — `worktreeState` field + migration + backfill; clean/recreate endpoints (dirty-check, branch-kept); chat留痕 on each transition.
- **P2 (frontend)** — badge + cleanup dialog + recreate dialog + done/merge prompts; i18n; mobile.
- **P3 (cron + PLAN-037 P3)** — orphan-only cron; linked-repo iteration for clean/recreate/delete + linked-repo diff.

## Risks

- Touches create/execute/worktree/merge/delete/cron + schema — phase it; keep single-repo + worktree-off paths unchanged.
- Backfill must classify existing issues correctly (dir-on-disk → active).
- Re-create when the branch was deleted remotely (post-PR) → fall back to base; make that explicit in the prompt copy.
- Don't regress the freshly-shipped dock rail (terminalCwd resolves from worktree path).

## Alternatives (rejected)

- **Merged/pushed auto-cleanup heuristic** — rejected: PR/remote-merge and "just mark done" make "is it merged" unreliable + complex (the user's "不容易设计" intuition).
- **Keep done-age auto cron** — rejected: silent, status-coupled, misses non-done issues.
- **Pure AoE (delete-only, no keep-issue clean)** — rejected: bkd keeps issue chat history (AoE deletes sessions), so it needs a "clean worktree but keep the issue" action.

## Annotations

- 2026-06-08: Drafted from the worktree-lifecycle discussion. Interactive prototype built + reviewed (`/worktree-lifecycle-prototype.html`). Decisions 1–8 captured. Pending `proceed`.
- 2026-06-08: **Approved** (user "这个可以") → implementing.
- 2026-06-08: **P1 (backend) done** (not yet committed) — `issues.worktreeState` (`none|active|cleaned`) + migration `0032_violet_gargoyle.sql`; `worktree-state.ts` helper (`setWorktreeState` + `appendWorktreeNote` system-message留痕 + `markWorktreeActive` idempotent); create留痕 wired at ALL 4 create sites (execute/restart/spawn×2/fork, fires only on real none|cleaned→active); startup backfill in reconciler (dir-on-disk→active); `POST …/worktree/clean` (force opt, dirty→409 `worktree_dirty`, branch kept, →cleaned) + `…/worktree/recreate` (fetch+attach/base, →active); shared `WorktreeState` type + serializeIssue + openapi + client `clean/recreateIssueWorktree` + hooks `useCleanWorktree/useRecreateWorktree`. New test `api-worktree-lifecycle.test.ts` 2/2. Verified: api tsc 0 net-new (49 baseline), FE tsc 0, 59 issue/fork/worktree/linked tests pass, lint clean.
- 2026-06-08: **P2 (frontend) done** (not yet committed) — `WorktreeStateBadge` (active/cleaned, mobile-safe) on issue detail header + kanban card (next to LinkedReposBadge); `useWorktreeLifecycle` hook owning cleanup dialog (dirty→escalate to force checkbox) + recreate gate; **done offer** (status control + kanban drag-to-done), **merge offer** (on merged), **recreate gate FULL** (status-back + send/execute via ChatInput beforeSend); i18n `worktree.*` 22 keys en==zh aligned. Verified: FE tsc 0, 414 FE tests pass, lint clean.
- 2026-06-08: **P3 done** (not yet committed) — (A) cron `worktree-cleanup` rewritten **orphan-only**: removes a worktree dir only when NO `issues` row by that id exists (hard-deleted; soft-deleted rows kept as restorable); dropped DONE_AGE/status=done; empty-parent prune kept; `worktree:autoCleanup` still OFF-by-default (now means "auto-prune orphans"). New test `cron-worktree-orphan-cleanup.test.ts`. (B) clean/recreate/delete now **iterate primary + linked repos**: clean dirty-checks ALL repos (any dirty + !force → 409 `worktree_dirty`, no partial), force removes all, branches kept, state flips only after all succeed; recreate re-materializes primary + `materializeLinkedWorktrees`; delete loops repos best-effort. (C) **linked-repo diff**: new `getIssueForProjectOrLinked(projectId, issueId)` shared helper (accepts primary OR any linked project, else 404); all 4 changes handlers use it; root resolves the requested project's own worktree; SEC path-containment preserved. Verified: api tsc 0 net-new (49), 4 lifecycle/cron tests + worktree/linked/changes suites pass, lint clean. **PLAN-038 + PLAN-037 P3 both satisfied.**
