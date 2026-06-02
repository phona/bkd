# Bundle-state audit (Task 7, Stage 3 of engine-injection)

## Goal

For safe route hot-reload, `createApp()` must be a pure route builder. A hot-reload
means the launcher does `import(<new server.js>)` — a **brand-new module graph** — and
calls `createApp()` on it. Anything that is a module-level singleton in the bundle is
therefore **duplicated** on each reload: the new graph gets a fresh instance, while the
core (loaded once from the original graph) keeps the old one.

This note enumerates every module-level mutable state reachable from the BUNDLE
(routes + engine code) and classifies each:

- **move-to-core (needs continuity)** — state whose identity must survive a reload
  because something long-lived (the core engine, active SSE clients, in-flight work)
  holds a reference to a specific instance.
- **safe-to-rebuild (pure cache)** — derived/cached data that rebuilds on demand. A
  fresh empty instance after reload is harmless (at worst a cold cache / one extra DB
  read or probe).

Architecture reminder (`app-entry.ts`): the launcher loads the bundle in a SEPARATE
module graph and runs `createCore()` (engine + lifecycle) ONCE; `createApp()` may be
re-run. The engine instance is shared via the `setEngine`/`getEngine` accessor
(`engines/issue/engine-ref.ts`), so it already survives a route rebuild.

---

## CRITICAL FINDING — `appEvents` is a bundle-level singleton (MUST move to core)

**File:** `apps/api/src/events/index.ts`

```ts
export const appEvents = new AppEventBus()
```

`AppEventBus` (`events/event-bus.ts`) holds `subscribers: Map<event, SubscriberEntry[]>` —
i.e. the live wiring between **emitters** and **subscribers**.

### Who emits / who subscribes

- **Emitters (live in the engine / core graph):**
  - `engines/issue/events.ts` → `appEvents.emit('state' | 'done', …)`
  - `engines/issue/pipeline/timeline-emit.ts`, `streams/handlers.ts`,
    `engines/issue/user-message.ts`, `engines/reconciler.ts` → `appEvents.emit('timeline-entry', …)` etc.
  - `events/changes-summary.ts` (started by `initEngineLifecycle`, i.e. core) both
    subscribes to `'done'` and emits `'changes-summary'`.
- **Subscribers (live in the route graph):**
  - `routes/events.ts` (global SSE) → `appEvents.on('timeline-entry' | 'state' | 'done' | 'changes-summary', …)`
  - `routes/cockpit/*`, `mcp/*` also subscribe.

Both sides resolve `@/events` from the **same module graph today**, so they share one
`appEvents`. That is the only reason events reach SSE.

### Why hot-reload breaks it

On a route hot-reload the launcher imports a NEW `server.js` (new module graph).
`createApp()` in the new graph subscribes `routes/events.ts` to the **NEW**
`appEvents`. But the core's engine — loaded once in the ORIGINAL graph and persisted
via `getEngine()` — still emits to the **OLD** `appEvents`. Result: emitters and
subscribers are on two different buses → **SSE log/state/done events silently stop**.
(`changes-summary` is doubly affected: its watcher was started by the core against the
old bus, so even the emit side is on the old bus.)

### Required fix for Task 8

`appEvents` must have **one identity for the whole process lifetime**, owned by the core
and injected into the routes. Concretely, one of:

1. **Create in `createCore()` and inject** — build `appEvents` (or pass the existing
   singleton) into `createCore()`, hold it on the `Core`, and pass it into
   `createApp(deps)` via `AppDeps` (e.g. `deps.appEvents`). `routes/events.ts` and the
   other subscribers take the bus from app deps / context instead of importing the
   module singleton. The engine must also emit to this same injected bus (today the
   engine imports the module singleton directly — that import must be replaced by an
   injected reference, mirroring the `getEngine()` accessor pattern).
2. **Accessor pattern (mirror `engine-ref.ts`)** — add `events/bus-ref.ts` with
   `setBus()/getBus()`; the core calls `setBus(new AppEventBus())` once; every
   emitter/subscriber goes through `getBus()`. Lower blast radius than threading deps
   through every call site, and consistent with how the engine was migrated in Stage 1.

Recommendation: option 2 (accessor) — it matches the already-shipped `engine-ref`
migration and avoids plumbing a bus argument through deep emit call sites.

> Note: `createApp()` itself never references `appEvents` directly — the wiring lives in
> the route modules it mounts (`routes/events.ts`, `routes/cockpit/*`) and in engine
> emit sites. So this fix is orthogonal to Task 7's createApp-purity change; Task 7 does
> not regress it, but does not fix it either. It is squarely a Task 8 item.

---

## Other module-level state

### `apps/api/src/cache.ts` — LRU+TTL Map cache → **safe-to-rebuild**

- State: `store`, `expiryMap`, `accessOrder` (`Map`s) + a `setInterval` sweep timer
  (`.unref()`'d).
- Verdict: **safe-to-rebuild.** Pure derived cache (`cacheGetOrSet` re-fetches on miss).
  A reload yields an empty cache → at worst a cold start (one extra DB read / probe).
- Caveat (not correctness, just hygiene): each reloaded bundle starts a NEW unref'd
  sweep `setInterval`. Old graphs are GC'd once unreferenced, so the timer is collected
  too; not a leak in practice. If reloads are frequent, consider moving the singleton
  cache to core to avoid losing warm entries — optional, not required.

### `apps/api/src/engines/startup-probe.ts` — engine discovery → **safe-to-rebuild**

- State: `probeInFlight: Promise | null` (in-flight dedupe). The probe RESULTS live in
  the shared `cache.ts` (keys `engines:available`, `engines:models:*`) and also in DB
  (`appSettings` via `saveProbeResults`/`getProbeResults`).
- Verdict: **safe-to-rebuild.** A fresh `probeInFlight=null` after reload just means the
  first caller re-probes (or reads the DB/memory cache). No continuity needed. (Task 7
  moved the boot warmup `getEngineDiscovery()` into `initEngineLifecycle`/core so it
  still runs once; that is about *when it runs*, not about persisting this `let`.)

### `apps/api/src/engines/issue/queries.ts` — slash-commands cache → **safe-to-rebuild**

- State: `cachedCommands: Map<EngineType, CategorizedCommands>` — per-engine commands
  loaded from DB (`engine:slashCommands:*`).
- Verdict: **safe-to-rebuild.** Backed by DB; `refreshSlashCommandsCache()` repopulates.
  `initEngineLifecycle` already calls `migrateSlashCommandsKey().then(refreshSlashCommandsCache)`
  at boot, so a reloaded bundle's empty map is refilled (and routes lazily reload on miss).

### The engine itself — `IssueEngine` / `ProcessManager` → **already in core**

- `engines/issue/engine-ref.ts` holds `let current: IssueEngine | undefined`, set via
  `setEngine()` in `createCore()` and read via `getEngine()` everywhere.
- `IssueEngine` (`engine.ts`) owns the `ProcessManager`, per-issue locks, entry/turn
  counters, and a GC `setInterval`. `ProcessManager` owns the live subprocess registry.
- Verdict: **already move-to-core (done in Stage 1).** This is the canonical example of
  the pattern `appEvents` should follow. NOTE: after a reload, the NEW bundle's
  `engine-ref` module starts with `current = undefined` until `setEngine` is called —
  but the core never re-runs `createCore`, so the NEW graph's accessor would be empty.
  This means **`getEngine()` resolution across graphs depends on the launcher passing the
  engine into the new graph** (via `createApp(deps)` injection or by calling `setEngine`
  on the new graph's accessor). This is the same cross-graph-singleton hazard as
  `appEvents` and must be handled by the Task 8 injection mechanism. Flag for Task 8:
  confirm the reloaded route graph's `getEngine()` resolves to the persistent core
  engine, not an empty fresh accessor.

### `apps/api/src/engines/reconciler.ts` — periodic timer + settled hook → **already in core**

- State: `reconcileTimer: setInterval | null`, plus `registerSettledReconciliation()`
  subscribes to engine settlement. Started/stopped by `initEngineLifecycle`/`LauncherStops`.
- Verdict: **in core already** (run once by `createCore` → `initEngineLifecycle`, not by
  `createApp`). Not reachable as a side-effect of `createApp`. No action.

### `apps/api/src/engines/safe-env.ts` — env cache → **safe-to-rebuild**

- State: `let _globalEnvCache`, `let _globalEnvCacheAt`. Backed by DB; refreshed by
  `refreshGlobalEnvCache()` (called in `initEngineLifecycle`). Verdict: **safe-to-rebuild.**

### `apps/api/src/engines/issue/role-callback.ts` — `invocationChains: Map` → **safe-to-rebuild**

- State: transient per-invocation chains for loop detection within a single execution.
- Verdict: **safe-to-rebuild.** Scoped to live executions; reloads should not happen
  mid-execution (drain first). Empty map after reload is acceptable.

### `apps/api/src/engines/spawn.ts` & executors (`claude`, `codex`) — resolve caches → **safe-to-rebuild**

- State: `resolveCache: Map<string,string|null>` (binary path resolution),
  `let _cachedBaseCmd` in `claude/executor.ts` and `codex/executor.ts`.
- Verdict: **safe-to-rebuild.** Pure memoization of CLI binary discovery; recomputes on
  miss. No continuity needed.

### `apps/api/src/events/changes-summary.ts` — `let unsubscribeDone` → **already in core**

- State: `let unsubscribeDone` plus a subscription on `appEvents('done')`. Started by
  `startChangesSummaryWatcher()` in `initEngineLifecycle` (core). Verdict: **in core.**
  BUT it subscribes to `appEvents` — so it inherits the `appEvents` cross-graph problem
  above. Once `appEvents` is core-owned/injected (the critical fix), this watcher is fine.

---

## Summary table

| File | State | Verdict | How (if move-to-core) |
| --- | --- | --- | --- |
| `events/index.ts` (`appEvents`) | EventBus subscriber map | **MUST move-to-core** | Accessor (`events/bus-ref.ts` set in `createCore`) OR inject via `AppDeps`; engine emits + routes subscribe through the shared instance. **Task 8 blocker.** |
| `engines/issue/engine-ref.ts` (engine) | IssueEngine + ProcessManager | already core | `setEngine` in `createCore`; ensure reloaded graph's `getEngine()` resolves to it (Task 8). |
| `engines/reconciler.ts` | timer + settled hook | already core | run by `initEngineLifecycle`. |
| `events/changes-summary.ts` | watcher + `done` sub | already core | run by `initEngineLifecycle`; depends on `appEvents` fix. |
| `cache.ts` | LRU/TTL maps + sweep timer | safe-to-rebuild | — (optional: core-own to keep warm entries). |
| `engines/startup-probe.ts` | `probeInFlight` | safe-to-rebuild | results in shared cache + DB. |
| `engines/issue/queries.ts` | `cachedCommands` | safe-to-rebuild | DB-backed; `refreshSlashCommandsCache` at boot. |
| `engines/safe-env.ts` | env cache | safe-to-rebuild | DB-backed; refreshed at boot. |
| `engines/issue/role-callback.ts` | `invocationChains` | safe-to-rebuild | transient per-execution. |
| `engines/spawn.ts`, executors | resolve/baseCmd caches | safe-to-rebuild | pure memoization. |

## Key takeaway for Task 8

There are **two** cross-graph singletons that break event/work continuity on hot-reload:
1. **`appEvents`** (events bus) — the single most important fix; without it SSE dies.
2. **engine accessor** (`engine-ref`) — already core-owned, but the reloaded route graph
   must be wired to the SAME instance (injection), or its fresh accessor is empty.

Everything else under `routes/`/`engines/` is either already core-run via
`initEngineLifecycle` or a pure cache that is safe to rebuild on demand.
