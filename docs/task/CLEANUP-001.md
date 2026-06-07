---
id: CLEANUP-001
title: Remove the roles / participants / @-mention multi-agent subsystem
status: completed
priority: P2
owner: claude
created: 2026-06-07
updated: 2026-06-07
---

# CLEANUP-001 — Remove roles / participants / @-mention

## Why

Unused. The original intent was multi-agent handoff (assign "roles" to an issue,
@-mention them in chat, roles can be external HTTP/MCP agents). The user never
used it — subagents within one agent cover the handoff need. Aligns with the
"single-agent self-use, no PM/platform" direction.

## Scope removed

- Frontend: `ParticipantPanel`, `RoleMentionPicker`, `RoleCreatorModal`; the
  @-mention system in `ChatInput`; ParticipantPanel/RoleCreatorModal from
  `ChatArea`; role/participant hooks in `use-kanban`; role API client + `Role`/
  `CreateRolePayload` types in `kanban-api`.
- Backend: `routes/roles`, `routes/issue-roles`, `routes/issues/roles`,
  `engines/issue/role-invoke`, `role-callback`, `role-host`; route mounts; the
  role/host invoke block in `routes/issues/message.ts` (was gated on
  `issueHasAssignedRole`, so normal sends are unaffected); 8 role test files.

## Kept

- `Workspace` / `CommandRoom` — independent (no role API usage), untouched.
- DB tables `roles` / `issue_roles` and the openapi role route defs — left dormant
  (no destructive migration). Can be dropped later if desired.

## Verification

Frontend tsc clean + 404 tests + production build OK. No dangling imports to any
deleted module. API test failures are pre-existing engine-environment flakiness
(count varied 85↔28 vs main's 75; none role- or import-related).
