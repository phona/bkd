# PLAN-023 Terminal PTY leak fix and slot accounting

- **status**: completed
- **createdAt**: 2026-06-06 13:48
- **approvedAt**: 2026-06-06 13:52
- **relatedTask**: BUG-004

## Context

Reproduced against the running deploy: `POST /api/terminal` →
`429 {"success":false,"error":"Session limit reached"}`. `MAX_SESSIONS = 10`
(`apps/api/src/routes/terminal.ts:74`). Process table shows **181 live
`/bin/bash -l`** parented by the launcher (pid 1472491), proving PTY shells leak.

Code path:
- Spawn: `Bun.spawn([shell,'-l'], { terminal })` cast `as unknown as Subprocess`
  (`terminal.ts:156-180`).
- `killSession()` (`terminal.ts:87-98`): `pty.terminal?.close()` →
  `terminalPM.forceKill(id)` (`process-manager.ts:216` → `handle.kill(9)`) →
  `terminalPM.remove(id)`.
- `monitorExit()` (`process-manager.ts:377`) awaits `entry.handle.exited`; on
  resolve transitions to terminal state and stops counting as active.
- `terminalPM` registered with `autoCleanupDelayMs: 0`, periodic expiry only at
  24h (`terminal.ts:113-126`); `onExit` handler removes the entry.

Divergence: `kill(9)` / `terminal.close()` do not actually terminate the Bun PTY
shell, but `remove(id)` deletes the PM record regardless → slot freed, shell
orphaned. Over a long-lived server this saturates the live cap.

### Confirmed findings (initial hypothesis was wrong)

- A repro (`tmp/pty-repro.ts`, Bun 1.3.13) shows the CURRENT kill path works in
  dev: `terminal.close()` ✓, `proc.kill(9)` ✓, `process.kill(-pid,9)` ✓;
  only `proc.kill()` (SIGTERM) leaks (bash `-l` ignores SIGTERM).
- The deployed kill code is unchanged across all builds (v0.0.53 → v0.0.187):
  `killSession` = `terminal.close()` + `forceKill`(SIGKILL) + `remove`. So the
  leak is NOT an old SIGTERM build.
- Therefore the real leak vectors are:
  1. **Unattached-session leak**: the grace timer is armed ONLY in WS
     `onClose`/`onError` (`terminal.ts:287,306`). A session created by `POST`
     whose WS never attaches (connect race / unmount / reconnect churn) never
     gets `killSession` → lives until the 24h sweep. Over a long-lived server
     this accumulates (observed: 181 leaked shells).
  2. **Non-atomic slot release**: `killSession` calls `remove(id)` right after
     `forceKill` without confirming the process is dead, so any kill failure /
     compiled-binary PTY quirk frees the slot while the shell survives.

## Proposal

1. **Track attachment + arm a creation-time reaper.** Add `everAttached` and an
   `unattachedTimer` to `TerminalMeta`. On `POST`, arm a timer
   (`BKD_TERMINAL_UNATTACHED_MS`, default 30s); if no WS has attached by then,
   `killSession`. Clear it in `onOpen` and set `everAttached = true`.
2. **Make kill robust.** Extract `killPty(proc)` doing `terminal.close()` +
   process-group SIGKILL (`process.kill(-pid, 9)`, proven in repro; also reaps
   any child procs) with `proc.kill(9)` fallback. Use it in `killSession`.
3. **Reap dead/divergent entries.** In the periodic sweep, also remove entries
   whose underlying pid is no longer alive (`process.kill(pid,0)` throws),
   closing the accounting divergence; run it on a tighter cadence.
4. **Regression test.** `test/terminal-lifecycle.test.ts`: (a) `killPty` actually
   kills a spawned PTY (pid dead afterwards); (b) an unattached session is reaped
   after the timeout (GET /terminal/:id → 404).
5. Operational cleanup of the 181 already-leaked shells stays a separate,
   user-approved, non-restart step (does not touch the launcher or live agents).

## Risks

- Wrong kill signal could leave zombies or kill the wrong process — must scope to
  the PTY child only; never touch sibling agent processes.
- Compiled launcher build: fix only takes effect after rebuild + redeploy.
- Behavior differences between dev (`bun run dev`) and compiled launcher for Bun
  PTY — verify in both.

## Scope

- `apps/api/src/routes/terminal.ts` (kill/grace/expiry)
- possibly `apps/api/src/engines/process-manager.ts` and `engines/spawn.ts`
  (PTY-aware kill)
- a focused test for spawn→kill→exited.

## Alternatives

- Raise `MAX_SESSIONS` — rejected: masks the leak, does not fix it.
- Restart-on-saturation — rejected: would kill live agents.

## Annotations

(none yet)
