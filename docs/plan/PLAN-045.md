# PLAN-045 Move ACP protocol handshake outside per-issue lock

- **status**: draft
- **createdAt**: 2026-06-09 16:45
- **approvedAt**: (pending)
- **relatedTask**: PERF-001

## Context

Investigation of "BKD gets stuck after running multiple issues" revealed:

**Root cause:** `spawnAcpProcess()` in `acp-client.ts` awaits `handler.initialize()` and `handler.startSession()` inside the per-issue lock (`withIssueLock`). Both are cross-process ACP protocol handshakes that wait for the opencode child process to respond. When 5 opencode processes spawn concurrently, each handshake gets progressively slower (38→57→87→105→120s), hitting the 120s lock execution timeout.

**Evidence:**
- `apps/api/src/engines/executors/acp/acp-client.ts:10-57` — `handler.initialize()` and `handler.startSession()` both awaited inside lock
- `apps/api/src/engines/issue/orchestration/execute.ts` — entire `executeIssue()` body runs under `withIssueLock`
- `apps/api/src/engines/issue/orchestration/follow-up.ts` — entire `followUpIssue()` body runs under `withIssueLock`
- `apps/api/src/engines/issue/lifecycle/spawn.ts` — `spawnFollowUpProcess()` runs under the lock too
- System log: `issue_lock_long_hold` at 38s, 57s, 87s, 105s, 120s — all during spawn phase
- BKD has 16 threads, 3.86M involuntary context switches

**Affected files:**
- `apps/api/src/engines/executors/acp/acp-client.ts` — `spawnAcpProcess()` contains the awaited handshake
- `apps/api/src/engines/issue/orchestration/execute.ts` — lock wraps entire execute flow
- `apps/api/src/engines/issue/orchestration/follow-up.ts` — lock wraps entire follow-up flow
- `apps/api/src/engines/issue/lifecycle/spawn.ts` — lock wraps fallback spawn path
- `apps/api/src/engines/issue/process/guards.ts` — `ensureNoActiveProcess()`

## Proposal

Split `spawnAcpProcess()` into two phases:

1. **Phase 1 (outside lock):** `spawnAcpChild()` + `handler.initialize()` + `handler.startSession()` — creates the child process and completes ACP handshake
2. **Phase 2 (inside lock):** Register the already-initialized handler with PM + DB updates

Specifically:

```typescript
// New function: preSpawnAcpProcess() — runs outside lock
export async function preSpawnAcpProcess(options: {...}): Promise<PreSpawnedAcpProcess> {
  const child = spawnAcpChild(options.cmd, options.workingDir, options.env)
  const subprocess = createSubprocessFromChild(child)
  const handler = new AcpProtocolHandler(child, options.permissionMode)
  await handler.initialize()
  const response = await handler.startSession(options.workingDir, options.model, options.sessionId)
  // sendUserMessage still fire-and-forget
  handler.sendUserMessage(options.prompt, options.attachments).catch(() => {})
  return { subprocess, handler, response }
}

// Modified spawnAcpProcess() — wraps preSpawn result into SpawnedProcess
export function finalizeAcpSpawn(preSpawned: PreSpawnedAcpProcess): SpawnedProcess {
  const { subprocess, handler } = preSpawned
  return {
    subprocess,
    stdout: handler.stdout,
    stderr: subprocess.stderr,
    cancel: () => { void handler.interrupt() },
    protocolHandler: { ... },
    externalSessionId: handler.currentSessionId,
    spawnCommand: options.cmd.join(' '),
  }
}
```

In `execute.ts` and `follow-up.ts` / `spawn.ts`:
```typescript
// Outside lock: ACP handshake
const preSpawned = await preSpawnAcpProcess({...})

// Inside lock: register + DB writes only
const spawned = await withIssueLock(ctx, issueId, async () => {
  ensureNoActiveProcess()
  updateIssueSession(...)
  const spawned = finalizeAcpSpawn(preSpawned)
  register(ctx, spawned, ...)
  monitorCompletion(...)
  return spawned
})
```

**Kill the pre-spawned process if lock fails:** If the lock acquire times out or throws, the pre-spawned child process must be killed to avoid orphaned processes.

## Risks

1. **Orphaned child process:** If lock fails after ACP handshake, the child process must be killed. Mitigation: wrap in try/catch, kill child on failure.
2. **Process lifecycle gap:** Between handshake completion and PM registration, the child process could die. Mitigation: check `subprocess.exited` state before registration; if already dead, skip and handle gracefully.
3. **Concurrent cancel:** A cancel could arrive between handshake and lock. Mitigation: `ensureNoActiveProcess()` still guards, but cancel timing window exists. Acceptable since cancel already has best-effort semantics.
4. **Other executors unaffected:** Claude Code, Claude SDK, Codex executors don't use ACP protocol — they do simpler spawns. No change needed there.

## Scope

- **`acp-client.ts`**: Split `spawnAcpProcess()` into `preSpawnAcpProcess()` + `finalizeAcpSpawn()` (~50 lines)
- **`execute.ts`**: Move handshake before lock, add cleanup on failure (~20 lines)
- **`follow-up.ts`**: Same pattern (~15 lines)
- **`spawn.ts`**: Same pattern for `spawnFollowUpProcess()` fallback path (~15 lines)
- **`guards.ts`**: No change needed
- **`process-manager.ts`**: No change needed
- **Estimated total**: ~100 lines changed across 4 files

## Alternatives

1. **Add timeout to handshake only:** Simpler but doesn't solve the real problem — timeouts still fail
2. **Reduce MAX_CONCURRENT_EXECUTIONS:** Addresses symptom, not root cause. 5 concurrent spawns on 6-core machine should work fine.
3. **Use process pool / pre-warm:** Over-engineering for current scale. Deferred.

## Annotations

