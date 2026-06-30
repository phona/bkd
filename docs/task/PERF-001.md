# PERF-001 Reduce per-issue lock contention during concurrent ACP spawns

- **status**: in_progress
- **priority**: P1
- **owner**: weifashi
- **createdAt**: 2026-06-09 16:45

## Description

When multiple ACP (opencode) issues are spawned concurrently, the per-issue lock holds for 38-120 seconds due to `handler.initialize()` and `handler.startSession()` being awaited inside `withIssueLock`. These are ACP protocol handshake operations that wait for the child process to respond, and they get progressively slower with more concurrent spawns.

The fix is to move these two operations outside the per-issue lock, keeping only the minimum critical section (DB writes and PM registration) under the lock.

Investigation evidence:
- `acp-client.ts` lines 26-34: `handler.initialize()` + `handler.startSession()` both awaited inside lock
- Log shows lock holds 38→57→87→105→120s linear growth with concurrent spawns
- All lock holds are during the `issue_execute_spawned` phase
- 4 of 5 stuck issues from same project `joqfkhrg` competing on git + ACP handshake

## ActiveForm

Moving ACP protocol handshake outside per-issue lock

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Root cause confirmed 2026-06-09: `spawnAcpProcess()` in `acp-client.ts` awaits `handler.initialize()` and `handler.startSession()` inside the lock. These cross-process protocol handshakes grow slower with concurrent opencode subprocesses.
