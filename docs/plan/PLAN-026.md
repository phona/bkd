# PLAN-026 Worktree-aware terminal cwd

- **status**: completed
- **createdAt**: 2026-06-06 13:48
- **approvedAt**: 2026-06-06 14:20
- **relatedTask**: WT-002

## Context

- Terminal cwd hardcoded `process.env.HOME || '/'`
  (`apps/api/src/routes/terminal.ts:171`); `POST /terminal` reads no body.
- Frontend `TerminalView.createSession()` POSTs with no params
  (`components/terminal/TerminalView.tsx:127-132`).
- `terminal-store` carries no issue/worktree context.
- Engine execution already uses the correct worktree dir
  (`engines/issue/orchestration/execute.ts:69-76,165`), so only the terminal is
  misaligned. Frontend already knows the worktree path (IssueDetail reads
  `worktreeEntry?.path`).

## Proposal

1. Backend: `POST /api/terminal` accepts optional `cwd`. Validate against an
   allowlist: resolve real path and require it to be inside a known project dir
   or worktree base (reject `..` traversal / arbitrary paths). Fall back to HOME
   when absent/invalid.
2. Frontend: when opening the terminal from an issue, pass that issue's worktree
   path (or project dir if no worktree). Global `/terminal` passes nothing →
   default.
3. Carry the cwd/issue association in terminal-store / open call as needed.

## Risks

- Arbitrary cwd is a security hole — allowlist validation is mandatory and is the
  core of this change.
- Sequencing: lands on the same route as BUG-004; do BUG-004 first to avoid
  rebasing the leak fix.

## Scope

- `apps/api/src/routes/terminal.ts` (+ schema), small frontend changes in
  `components/terminal/*` and `stores/terminal-store.ts`.

## Alternatives

- Always open at project root (ignore worktree) — simpler but does not fix the
  "wrong place" complaint for worktree issues. Rejected.

## Annotations

(none yet)
