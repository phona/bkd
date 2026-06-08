# PLAN-037 Multi-project association — same-branch worktrees across linked projects

- **status**: implementing
- **createdAt**: 2026-06-08
- **approvedAt**: (pending)
- **relatedTask**: WS-001 (to be created)
- **borrowed-from**: AoE (session spans repos; one worktree per repo on the same branch)

## Context (investigation)

Today a bkd issue belongs to ONE project; `createWorktree` makes a single worktree
at `WORKTREE_BASE/{projectId}/{issueId}` on `bkd/{slug}-{id}`. The user wants AoE's
"associate other projects when creating a session, so the same branch's worktree is
created in each linked repo".

Findings:
- `issues.workspaceId` FK → `workspaces` table ALREADY exists (db/schema.ts:40), and
  `workspaces` stores `repos[]` ({url, defaultBranch, role}). This mirrors AoE's
  `session → workspace_info.repos`. It is **wired in the schema but unused by the
  create flow / worktree creation / diff / terminal** (CommandRoom is a ~40-line stub).
- AoE model: a session's `workspace_info.repos` each get a worktree on the session's
  branch; deletion iterates repos; sessions group by `repoPath::branch`.
- bkd's natural unit is a **project** (= a repo directory). The user said "关联其它
  项目" → associate PROJECTS, not arbitrary repo URLs.
- Single-project assumptions to revisit: worktree path/creation, `terminalCwd`,
  changes/diff root, the new dock rail (terminal/files/diff are project-scoped),
  merge-back, delete/cleanup.

## Proposal (3 approaches)

**A — Project-level linking on the issue (recommended).** At create time the user
can link additional bkd projects (each a git repo dir). On first worktree
materialization, create a worktree in EACH linked project's repo on the SAME derived
branch (`bkd/{slug}-{id}`), same base resolution + fetch as today. The issue carries
a primary project + a set of linked projects. The dock rail (terminal/files/diff)
gains a small **repo switcher** so each panel can target any linked repo's worktree.
Merge-back / delete iterate all linked repos. Reuse the existing `workspaceId` plumbing
or a dedicated `issue_projects` link table.

**B — Reuse the `workspaces` table as-is (URL repos).** Wire the existing
workspace/CommandRoom feature. Rejected as primary: repos are URL-based (not bkd
projects), the workspace UI is a stub, and it duplicates the project concept the user
actually means.

**C — Minimal first slice.** Only create the same-branch worktree in each linked
project at create time (no cross-repo diff/terminal switching yet). A safe phase-1 of A.

## Decisions (user: "按你推荐的来", 2026-06-08)

1. **Association unit** = bkd **projects** (A). Each project is a repo dir we already
   manage.
2. **Where** = **per-issue at creation** (a "link projects" multi-select in
   CreateIssueDialog). No separate preset/group for v1.
3. **Branch** = the SAME derived name `bkd/{slug}-{id}` in every linked repo. **Base
   per-repo = each repo's own default branch** (origin/HEAD…), resolved + fetched
   independently (a repo may have a different default).
4. **Dock rail** = include the **repo switcher** (full A) — a small repo selector atop
   the rail/overlay; terminal/files/diff target the selected repo's worktree. Built in
   the same pass (not deferred), since without it the extra worktrees aren't reachable
   in-app. Internally phase the backend (materialize all worktrees) before the switcher.
5. **Agent scope (v1)** = the agent **runs with cwd = the PRIMARY project's worktree**;
   linked repos are **materialized on disk (same branch) and surfaced** (rail switcher,
   terminal cd, file browser, diff) for the user + the agent to use, and the linked-repo
   paths are injected into the system prompt so the agent knows they exist. A v2 may give
   the agent native multi-repo awareness (combined diff attribution, per-repo cwd), but
   that is OUT of v1 to keep the execution model intact.

## Phasing (v1)

P1 (backend) — link table `issue_projects(issueId, projectId, isPrimary)`; create.ts
accepts linkedProjectIds; worktree materialization loops the linked projects (same
branch, per-repo base+fetch, partial-failure tolerant); inject linked-repo paths into
the prompt.
P2 (frontend) — CreateIssueDialog project linker; dock rail + mobile overlay repo
switcher (terminal/files/diff scoped to the selected repo); card/detail "N repos"
surfacing. i18n en+zh; mobile parity.
P3 — merge-back + delete iterate all linked repos.

## Risks

- Model change (issue ↔ multiple projects) touches create/execute/worktree/diff/
  terminal/merge/delete — high blast radius; phase it (C → A).
- Cross-repo worktree consistency (a repo without the base branch, dirty repo, missing
  remote) — partial-failure handling.
- Interplay with the freshly-shipped dock rail + worktree fetch/naming.
- Cleanup/merge must iterate repos without orphaning worktrees/branches.

## Scope

Backend: schema (link table or reuse workspaceId), create.ts, execute/worktree
materialization (loop repos), changes/diff + terminal cwd (repo-aware), merge-back +
delete (iterate). Frontend: CreateIssueDialog (project linker), dock rail repo switcher,
KanbanCard/IssueDetail surfacing. i18n en+zh. Mobile parity.

## Alternatives

Keep single-project (status quo) — rejected; the user wants AoE parity. Full
flexible multi-repo workspaces (B, developed) — heavier, defer.

## Annotations

- 2026-06-08: Investigated. `issues.workspaceId` + `workspaces.repos` already exist
  (unused) — the schema half-mirrors AoE. Proposal pending decisions 1–5 + `proceed`.
- 2026-06-08: **P1 (backend) shipped** (69ba1cd) — issue_projects link table + migration
  0031; create.ts linkedProjectIds (validated); materializeLinkedWorktrees (same branch
  per linked repo, per-repo base+fetch, partial-failure tolerant) + linked-repo paths
  injected into the agent prompt; GET …/linked route + shared type + client/hook. P1
  verified: api tsc 0 new + 4/4 new test; FE tsc 0.
- 2026-06-08: **P2 (frontend) shipped** (fc3367c) — CreateIssueDialog project linker
  (select-all); DockRepoSwitcher + use-dock-repo wired into DockRail + MobileDockOverlay
  (terminal/files/diff retarget the selected repo); LinkedReposBadge on card + detail;
  i18n. Single-repo behavior unchanged. Verified: FE tsc 0 + 414 tests. Deployed 0.0.213.
- 2026-06-08: **P3 done** (not yet committed) — implemented together with PLAN-038 P3.
  (a) Diff for a LINKED repo fixed: new `getIssueForProjectOrLinked` helper in
  `routes/issues/_shared.ts`; all 4 changes handlers accept the issue's primary OR any
  linked project (else 404); root resolves the requested project's own worktree; SEC
  path checks preserved. (b) delete iterates primary + linked repos (worktree + branch,
  best-effort). NOTE: "merge-back" iteration — clean/recreate/delete now iterate linked
  repos; the Merge-to-base action itself still merges the primary (linked merge-back is a
  future item if needed). See PLAN-038 Annotations for full P3 detail + verification.
