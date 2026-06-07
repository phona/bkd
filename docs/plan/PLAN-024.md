# PLAN-024 Installable PWA (manifest + service worker)

- **status**: completed
- **createdAt**: 2026-06-06 13:48
- **approvedAt**: 2026-06-06 18:15
- **relatedTask**: PWA-001

## Context

- `apps/frontend/public/manifest.json` is stale: `short_name: "Kanban"`, single
  SVG icon, no maskable icons.
- `apps/frontend/index.html` does NOT link the manifest; only sets viewport +
  favicon.
- No service worker registration anywhere in `src/`.
- `vite-plugin-pwa` not installed (checked root + frontend package.json).
- Vite config: `apps/frontend/vite.config.ts`.

## Proposal

1. Add `vite-plugin-pwa` (catalog-managed dep) and register it in
   `vite.config.ts` with `registerType: 'autoUpdate'`.
2. Author a correct manifest (name "BKD", short_name "BKD", theme/background
   colors matching the app, `display: standalone`, maskable 192px + 512px PNG
   icons). Generate/commit the icons.
3. Add manifest link + `apple-mobile-web-app-*` / `theme-color` meta to
   `index.html`.
4. Configure Workbox to exclude `/api/*`, `/api/events` (SSE), and the terminal
   WS from caching; precache only the app shell + static assets.
5. Add a lightweight "new version available — reload" prompt wired to the SW
   update event.

## Risks

- Bad SW caching can serve stale builds — mitigate with autoUpdate + API
  exclusions + explicit update prompt.
- Standalone display can hide browser navigation — verify back/refresh UX on iOS.

## Scope

- `apps/frontend/vite.config.ts`, `index.html`, `public/manifest.json` (rewrite),
  new icon assets, a small SW-update hook/component.
- Catalog dep addition in root `package.json`.

## Alternatives

- Hand-rolled SW without the plugin — rejected: more maintenance, no Workbox.

## Annotations

(none yet)
