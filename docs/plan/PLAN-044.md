# PLAN-044 Deploy resilience — auto-reload open tabs on chunk/preload error

- **status**: completed
- **createdAt**: 2026-06-09
- **approvedAt**: 2026-06-09 (user chose option 2)
- **relatedTask**: BUILD-001
- **context**: the 0.0.220 deploy broke an OPEN tab ("加载不出消息"). 043/032 code verified correct (component renders real claude-code fixture fine); the break was a deploy-mechanics issue.

## Root cause (investigated)
- `decideUpgradeStrategy` (strategy.ts) CORRECTLY forces a restart on new migrations (0033) — so it was NOT a mis-hot-reload. The backend restarts cleanly.
- The break is the classic SPA+PWA deploy trap: `vite.config.ts` VitePWA `registerType: 'autoUpdate'` + `cleanupOutdatedCaches: true` + full precache. On deploy, the new service worker activates + claims the open tab + evicts outdated caches; the already-loaded app still requests OLD lazy-chunk hashes (all pages are `lazy()`); those chunks are gone (server only has the new version dir, SW cache cleaned) → chunk 404 → blank "messages won't load". There is NO `vite:preloadError` / ChunkLoadError handler (grep confirmed), so it doesn't self-heal.
- The long graceful-drain (blocked by 3 active issues) widened the window so the user hit it.

## Proposal
Standard, contained, engine-neutral fix: a global **`vite:preloadError` handler that reloads once** (loop-guarded) to fetch the fresh index + chunks. Vite dispatches `vite:preloadError` on `window` when a dynamic import fails. Place it in `main.tsx` before render.

```
window.addEventListener('vite:preloadError', (e) => {
  const KEY = 'bkd:preloadReloadAt'
  const last = Number(sessionStorage.getItem(KEY) || 0)
  if (Date.now() - last < 10_000) return  // already reloaded recently → let it surface
  sessionStorage.setItem(KEY, String(Date.now()))
  e.preventDefault?.()
  window.location.reload()
})
```

Optional follow-ups (NOT this plan): switch PWA to `registerType: 'prompt'` with a "new version, reload" toast; defer the version-pointer flip in apply.ts until just before respawn. The preloadError-reload is the high-value minimal fix.

## Risks
- Reload loop if the chunk is genuinely missing (not a deploy) — guarded by the 10s sessionStorage throttle (reloads once, then lets the error surface to the ErrorBoundary).
- The CURRENTLY-open pre-fix tab isn't protected by this deploy (the handler ships IN the new bundle) — so a one-time hard refresh is still needed for THIS deploy; every deploy after self-heals.

## Scope
Frontend only: `apps/frontend/src/main.tsx` (+ a small test). No backend. Bundle with the 043/032 redeploy (0.0.221).

## Annotations
- 2026-06-09: Investigated the 0.0.220 open-tab break. Root cause = autoUpdate PWA evicting old chunks under an open tab + no preloadError self-heal (NOT a 043 code bug; that's verified fine). Implementing the preloadError→reload handler.
