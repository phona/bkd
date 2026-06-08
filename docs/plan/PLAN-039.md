# PLAN-039 Worktree experience parity with AoE — global Worktree settings panel + strategy knobs

- **status**: completed
- **approvedAt**: 2026-06-08 (user: "一起搞" — P1+P2+P3)
- **createdAt**: 2026-06-08
- **relatedTask**: WT-004
- **borrowed-from**: AoE `[worktree]` config section + base-branch detection + on_create hooks
- **builds-on**: PLAN-037 (linked projects), PLAN-038 (worktree lifecycle state + delete dialog + orphan cron)

## Context / investigation

User: "怎么没看到地方配置 worktree 拉取的策略呢?类似 AoE" → "我想 worktree 的体验对齐 AoE". Today bkd's worktree knobs are scattered + partly hardcoded; there is **no global Worktree settings panel**. The fetch is hardcoded.

### AoE worktree config (`src/session/config.rs:1493-1614`, `git/template.rs`, `git/worktree.rs`)
`[worktree]` section, all config-driven, with defaults:
- `enabled` (false) — worktree on by default for new sessions
- `path_template` (`../{repo-name}-worktrees/{branch}`) — sibling worktree path
- `bare_repo_path_template` (`./{branch}`), `workspace_path_template` (`../{branch}-workspace-{session-id}`)
- `auto_cleanup` (true) — remove worktree dir on session delete
- `delete_branch_on_cleanup` (false) — also delete the branch
- `default_base_branch` (None) — fallback base branch; else auto-detect
- `init_submodules` (true) — `git submodule update --init --recursive` if `.gitmodules`
- `show_branch_in_tui` (true)
- Template vars: `{repo-name}` `{branch}` `{session-id}`; sanitize `/ @ # \ : * ? " < > |` → `-`.
- **Base-branch resolution**: per-session override → per-project → global `default_base_branch` → auto-detect (multi-remote scoring: remotes' HEAD, main/master, recency + ancestry + origin tiebreakers).
- **Fetch-before-branch**: ALWAYS fetch the chosen base/origin from its canonical remote before branching (10s timeout, stdin→null), non-fatal; worktree then branches off the remote tip.
- **on_create / on_launch / on_destroy hooks** (`repo_config.rs`): TOML arrays of shell commands run after worktree create / agent launch / before delete; `on_create` hard-fails session, env `REPO_NAME/BRANCH/SESSION_ID/PROJECT_PATH`; repo-level hooks need hash-approval (trust).
- **Delete dialog** (`delete_options.rs`): delete_worktree / force_delete / delete_branch (+ sandbox), dirty-check refuses unless force; empty-parent prune.

### bkd current state
- **Settings infra**: `appSettings` KV (`db/helpers.ts` `getAppSetting`/`setAppSetting`, 3600s cache); routes in `routes/settings/general.ts` (pattern: `worktree:autoCleanup` GET/PATCH at :123-150); frontend `AppSettingsDialog.tsx` sections (GeneralSection/CleanupSection/…) + `settings-layout.tsx` nav; hooks in `use-kanban.ts` (`useWorktreeAutoCleanup`/`useSet…`).
- **Per-issue knobs** (CreateIssueDialog advanced → create.ts): `useWorktree`, `worktreeBaseBranch`, `worktreeBranchName`, `worktreeAttachExisting`, `linkedProjectIds`.
- **Global**: `WORKTREE_DIR` env (`constants.ts:20`, default `worktrees`) → `WORKTREE_BASE`; `worktree:autoCleanup` setting (now orphan-prune).
- **Hardcoded**: `tryFetch` (best-effort `git fetch --prune`, 15s, no toggle); `deriveWorktreeBranch` → `bkd/{slug}-{id}` (fixed prefix); no submodule init; base branch = per-issue or git default (no global default, no multi-remote detection).
- **Already AoE-parity** (don't redo): lifecycle `worktreeState` (PLAN-038), delete dialog + dirty-check, merge-base diff (changes endpoint), worktree listing (settings/cleanup.ts), orphan cron, multi-repo (PLAN-037 linked projects = AoE workspace).

### bkd reality filter (no container/tmux)
N/A from AoE: in-container preclean, `on_launch`/`on_destroy` container hooks, relative `.git` conversion for mounts, sandbox stages, bare-repo/workspace templates (bkd uses projects + PLAN-037 linked projects instead of bare/workspace templates).

## Proposal

A new **Settings → Worktree** panel that centralizes global worktree strategy, plus a few backend behaviors to make the experience match AoE. Phased so the requested core ships first.

### P1 — Worktree settings panel (the core ask)
New `AppSettingsDialog` section "Worktree" (nav item `FolderGit2`) + backend setting keys (namespaced `worktree:*`, GET/PATCH in `general.ts`, hooks in use-kanban):
1. **Fetch strategy** `worktree:fetchStrategy` = `auto` (有远端就拉, default — current behavior) | `always` | `never`. Wire into `tryFetch`/`createWorktree`.
2. **Default base branch** `worktree:defaultBaseBranch` (string, blank = auto-detect). Used by `createWorktree` when the issue has no per-issue `worktreeBaseBranch`. Per-issue still overrides.
3. **Branch name template** `worktree:branchTemplate` (default `bkd/{slug}-{id}`). Vars `{slug}` `{id}` `{repo}`; validate git-safe + must include `{id}` (uniqueness). Wire into `deriveWorktreeBranch`.
4. **Auto-cleanup (orphans)** — surface the existing `worktree:autoCleanup` toggle here too (mirror CleanupSection) with the corrected "prune orphaned worktrees" copy.
5. **Worktree root** — display `WORKTREE_BASE` read-only (env-controlled; note changing it orphans existing worktrees) — display-only in v1.
i18n en+zh; mobile parity (settings-layout is already responsive).

### P2 — AoE strategy behaviors (opt-in extras)
6. **Default-branch detection** — when base branch unset, detect `origin/HEAD` (and main/master) instead of bare git default; targeted fetch of that base before branching (closer to AoE). 
7. **Submodule init** `worktree:initSubmodules` (default on) — after createWorktree, if `.gitmodules`, run `git submodule update --init --recursive` (best-effort, logged).
8. **Delete-dialog defaults** `worktree:deleteBranchDefault` (default off) — seed the delete dialog's "delete branch" checkbox.

### P3 — on_create setup script (meatier; flag for explicit opt-in)
9. **`worktree:setupScript`** — shell commands run in a freshly created worktree before the agent starts (e.g. `bun install`), env `REPO_NAME/BRANCH/ISSUE_ID/PROJECT_PATH`, timeout + logged to the issue timeline (留痕). Global v1; per-project later. This is the highest-value AoE parity item beyond config but is a real feature (process spawn + timeout + surfacing) — keep it its own phase. (No container = runs on host in the worktree dir.)

## Risks
- Changing `deriveWorktreeBranch` to a template touches branch naming for ALL new worktrees — validate template (git-safe, requires `{id}`), keep `bkd/{slug}-{id}` default so behavior is unchanged unless edited.
- `fetchStrategy=always` on repos with slow/auth remotes → keep the existing 15s timeout + non-fatal.
- Setup script (P3) runs arbitrary shell on the host in the worktree — only from the user's own settings (single-user tool), timeout-bounded, surfaced; no remote/untrusted source (so AoE's hash-approval trust model is N/A here).
- Per-issue overrides must keep precedence over the new globals.

## Scope
Backend: `general.ts` (or new `settings/worktree.ts`) setting keys + GET/PATCH; wire fetchStrategy/defaultBaseBranch/branchTemplate into `worktree.ts` (`tryFetch`, `createWorktree`, `deriveWorktreeBranch`); P2/P3 behaviors. Frontend: `AppSettingsDialog` WorktreeSection + nav + hooks + client; i18n en+zh; mobile. No schema change (all KV settings).

## Alternatives
- Per-project worktree config (AoE repo-level) instead of global — heavier; defer (global covers the solo-use case; per-project can layer later).
- Editable worktree root path — risky (orphans existing); display-only in v1.
- Keep everything hardcoded + only expose fetch toggle — too thin vs the "对齐 AoE" ask.

## Annotations
- 2026-06-08: Investigated AoE `[worktree]` config + base-branch/fetch/hooks/delete (very thorough) and bkd settings infra + current knobs. Mapped parity; filtered container/tmux-only items. Proposal P1 (panel) / P2 (strategy behaviors) / P3 (setup script). Pending `proceed` + which phases/knobs the user wants.
- 2026-06-08: **Implemented (P1+P2+P3), not yet deployed** — backend (5406dec range): new `settings/worktree.ts` + `worktree-keys.ts`, GET/PATCH `/api/settings/worktree` (KV, no schema); `tryFetch` honors fetchStrategy; `resolveBaseBranch` (per-issue>global>auto-detect origin/HEAD); `deriveWorktreeBranch` async template ({slug}{id}{repo}, must contain {id}); submodule init; on_create setup script (bash -lc, 300s, run-once via createWorktreeEx `created` + markWorktreeActive transition, timeline留痕). Frontend: WorktreeSection (8 controls) + nav + hooks + client; autoCleanup moved here (CleanupSection dup removed); delete-dialog "delete branch" seeded from deleteBranchDefault; i18n worktreeSettings.* 22 keys en==zh. Verified: api tsc 0 net-new (49) + 33 settings/worktree tests; FE tsc 0 + 414 tests; lint clean. N/A (no container/tmux): in-container preclean, on_launch/on_destroy, .git relativize, sandbox stages.
