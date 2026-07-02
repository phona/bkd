# AGENTS.md

This file provides guidance to AI coding agents working in this repository.

## Project Overview

BKD is a **self-hosted, engine-neutral chat tool for driving CLI-based AI coding agents** (Claude Code, OpenAI Codex, Gemini CLI, and ACP-compatible agents). It provides a Kanban board for organizing work, a chat-first issue-detail view for interacting with agents in real time, and supporting surfaces such as a file browser, diff viewer, web terminal, whiteboard, cron scheduler, and webhooks.

The repository is a **Bun Workspaces monorepo** containing:

- `apps/api` (`@bkd/api`) — Backend API server (Bun + Hono + SQLite)
- `apps/frontend` (`@bkd/frontend`) — React/Vite frontend
- `packages/shared` (`@bkd/shared`) — Shared TypeScript types
- `packages/tsconfig` (`@bkd/tsconfig`) — Shared TypeScript configurations

## Technology Stack

- **Runtime / package manager**: Bun
- **Backend framework**: Hono (`OpenAPIHono`) with `@hono/zod-openapi`, `@hono/swagger-ui`, `@hono/zod-validator`
- **Database**: SQLite via `bun:sqlite` with Drizzle ORM
- **Migrations**: Drizzle Kit (`apps/api/drizzle/`)
- **Logging**: pino
- **Frontend framework**: React 19 + Vite 7 + TypeScript
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite`, `@base-ui/react` primitives, shadcn/ui-style components
- **Drag & drop**: `@atlaskit/pragmatic-drag-and-drop`
- **Routing**: react-router-dom v7
- **Server state**: TanStack React Query v5 with `PersistQueryClientProvider`
- **Local UI state**: Zustand
- **Icons**: lucide-react
- **Syntax highlighting**: shiki v4 (slimmed bundles)
- **Terminal**: xterm.js over WebSocket
- **Diff rendering**: `@pierre/diffs/react`
- **i18n**: i18next + react-i18next (Chinese `zh` and English `en`; default is read from `localStorage`/`i18n-lang`, falling back to `zh`)
- **Testing**: `bun:test` (backend), Vitest + jsdom + @testing-library/react (frontend)
- **Linting**: @antfu/eslint-config
- **Build / packaging**: `scripts/compile.ts`, `scripts/package.ts`, `scripts/launcher.ts`

## Monorepo Structure

```
bkd/
├── apps/
│   ├── api/                      ← @bkd/api
│   │   ├── src/
│   │   │   ├── index.ts          ← Bun.serve entry, static serving, graceful shutdown
│   │   │   ├── app.ts            ← Hono/OpenAPIHono app + middleware + route mounts
│   │   │   ├── app-core.ts       ← Singleton lifecycle (event bus, engine, cron)
│   │   │   ├── app-entry.ts      ← Packaged-mode entry
│   │   │   ├── launcher-init.ts  ← Launcher-mode initialization
│   │   │   ├── config.ts         ← Hardcoded statuses (todo/working/review/done)
│   │   │   ├── logger.ts         ← pino logger
│   │   │   ├── auth/             ← JWT / OIDC auth middleware
│   │   │   ├── db/               ← SQLite/Drizzle schema, migrations, reset
│   │   │   ├── engines/          ← AI engine executors + issue lifecycle orchestration
│   │   │   ├── events/           ← In-memory event bus + SSE
│   │   │   ├── cron/             ← cronbake scheduler + cron actions
│   │   │   ├── routes/           ← API routes
│   │   │   ├── services/         ← Shared services
│   │   │   ├── cockpit/          ← Cockpit/assistant logic
│   │   │   ├── mcp/              ← MCP integration
│   │   │   ├── upgrade/          ← Self-upgrade service
│   │   │   ├── webhooks/         ← Webhook dispatcher
│   │   │   ├── openapi/          ← OpenAPI helpers
│   │   │   └── utils/            ← Utilities
│   │   ├── drizzle/              ← Database migrations
│   │   ├── drizzle.config.ts     ← Drizzle-kit configuration
│   │   └── test/                 ← Backend tests
│   └── frontend/                 ← @bkd/frontend
│       ├── src/
│       │   ├── main.tsx          ← App entry (QueryClient, router, AuthGate)
│       │   ├── components/       ← UI primitives + feature components
│       │   │   ├── ui/           ← shadcn-style primitives
│       │   │   ├── kanban/       ← Board, columns, cards, sidebar
│       │   │   ├── issue-detail/ ← Chat, diff, review, dock
│       │   │   ├── files/        ← File browser / editor
│       │   │   ├── terminal/     ← Terminal view
│       │   │   ├── settings/     ← Settings sections
│       │   │   ├── cockpit/      ← Dashboard widgets
│       │   │   ├── whiteboard/   ← Mindmap canvas
│       │   │   ├── workspace/    ← Workspace views
│       │   │   ├── notes/        ← Notes drawer
│       │   │   ├── processes/    ← Process manager drawer
│       │   │   └── search/       ← Search results
│       │   ├── hooks/            ← React Query hooks + custom hooks
│       │   ├── pages/            ← Route pages
│       │   ├── stores/           ← Zustand stores
│       │   ├── lib/              ← API client, utils, constants, event bus
│       │   ├── i18n/             ← en.json, zh.json
│       │   ├── __tests__/        ← Vitest tests
│       │   └── types/kanban.ts   ← Re-exports from @bkd/shared
│       ├── vite.config.ts
│       └── index.html
├── packages/
│   ├── tsconfig/                 ← Shared tsconfigs (base, hono, react, utils)
│   └── shared/                   ← @bkd/shared (shared TypeScript types)
├── scripts/
│   ├── compile.ts                ← Standalone binary compiler
│   ├── launcher.ts               ← Launcher binary entry
│   ├── package.ts                ← App package builder
│   ├── gen-openapi.ts
│   └── ...
├── skills/bkd/                   ← BKD skill package for CLI agents
├── docs/                         ← Architecture, API, task, plan docs
├── upgrade/                      ← Fix scripts for existing DBs
├── data/                         ← SQLite database + logs (gitignored)
├── package.json                  ← Root workspace + catalog
└── bun.lock
```

## Build, Test & Development Commands

```bash
# Dev (starts API on 3010 + Vite on 3000)
bun run dev
bun run dev:api              # API server only
bun run dev:frontend         # Vite dev server only

# Install / build
bun install                  # single install for all workspaces
bun run build                # build frontend -> apps/frontend/dist/
bun run start                # production API server

# Test
bun run test                 # all workspace tests in parallel
bun run test:api             # backend tests only
bun run test:frontend        # frontend tests only

# Lint / format
bun run lint                 # eslint . (also covers formatting)
bun run lint:fix             # eslint . --fix
bun run format               # alias for lint:fix
bun run format:check         # eslint . --fix-dry-run

# Database
bun run db:generate          # drizzle-kit generate
bun run db:migrate           # drizzle-kit migrate
bun run db:reset             # deletes SQLite DB files

# Packaging / distribution
bun run compile              # standalone full binary (~105 MB)
bun run compile:launcher     # launcher binary (~90 MB)
bun run package              # app package tar.gz (~1 MB)
```

Backend tests are run with `bun test --preload ./test/preload.ts test/`. The preload creates an isolated per-PID SQLite DB under `data/test/`, disables auth, and mocks the Codex executor. Frontend tests run with Vitest in a jsdom environment.

## Backend Architecture

### Entry & Lifecycle

- `apps/api/src/index.ts` — `Bun.serve()` entry point. Configures host/port (`HOST`/`PORT`, default `0.0.0.0:3000`), idle timeout, max request body size (~1 GB), WebSocket support, static asset serving, and graceful shutdown.
- `apps/api/src/app-core.ts` — Creates and tears down singletons: event bus, issue engine, cron scheduler, process manager, changes-summary watcher, etc.
- `apps/api/src/app.ts` — Builds the `OpenAPIHono` app, applies security headers, CORS, compression, HTTP logging, auth middleware, and mounts route modules.
- `apps/api/src/launcher-init.ts` and `app-entry.ts` — Launcher-mode and package-mode entry variants.
- Graceful shutdown cancels running engine processes, stops cron, closes WebSockets, releases the PID lock, and stops the HTTP server.

### Authentication

Auth is **optional** and enabled when `API_SECRET` is set. The `authMiddleware` in `apps/api/src/auth/` verifies Bearer tokens and `token` query parameters (JWT/OIDC-style). Public routes include `/api/auth/*`, `/api/docs`, `/api/openapi.json`, and `/api/health`.

### Security & Middleware

- `hono/secure-headers` with CSP/HSTS.
- CORS controlled by `ALLOWED_ORIGIN`.
- Compression enabled except for SSE routes.
- Global error handler returns `{ success: false, error }` envelope.
- Runtime `/api/runtime` endpoint is gated by `ENABLE_RUNTIME_ENDPOINT`.
- Filesystem routes harden against symlink traversal and escaping `ROOT_DIR`.
- Webhook URLs are validated to prevent SSRF.

### Database

- SQLite via `bun:sqlite`, path from `DB_PATH` (default `<ROOT_DIR>/data/db/bkd.db`).
- PRAGMAs: WAL, foreign keys ON, busy timeout 15s, synchronous NORMAL.
- Migrations live in `apps/api/drizzle/` (34+ migration files) and are auto-applied on startup. In compiled/package mode, embedded migrations are used.
- Post-migration schema verification exits the process on mismatch.

Core tables include `projects`, `workspaces`, `issues`, `issueProjects`, `issueLogs` (`issues_logs`), `issuesLogsToolsCall`, `attachments`, `appSettings`, `webhooks`/`webhookDeliveries`, `cronJobs`/`cronJobLogs`, `whiteboardNodes`, `cockpitTimelineMessages`, `notes`, `roles`/`issueRoles`. All tables share common fields (`createdAt`, `updatedAt`, `isDeleted`). IDs use short readable nanoids for user-facing entities and ULIDs for join/log rows.

### API Routes

All routes return the envelope `{ success: true, data: T } | { success: false, error: string }`. Routes are created via `createOpenAPIRouter()` with Zod validation. Mounted routers include:

- `/api/projects` and `/api/projects/:projectId/issues` — project/issue CRUD, bulk updates, execute/follow-up/restart/cancel, logs, changes, attachments, worktree, slash commands, export, duplicate, fork, summarize, linked projects.
- `/api/workspaces` — workspace CRUD, link/unlink projects.
- `/api/worktrees` — list/merge/delete worktrees.
- `/api/engines` — engine availability, profiles, settings, probe, hidden models.
- `/api/events` — global SSE stream (`log`, `log-updated`, `log-removed`, `state`, `done`, `issue-updated`, `changes-summary`, `cockpit-*`, 8s heartbeat).
- `/api/settings/*` — general, worktree, logs, cleanup, recycle bin, webhooks, upgrade, about, system-info.
- `/api/terminal` — WebSocket PTY terminal sessions.
- `/api/filesystem`, `/api/files`, `/api/git` — workspace file access and git operations.
- `/api/cron` — cron job CRUD, logs, trigger, pause/resume.
- `/api/processes` — active process listing, capacity, termination.
- `/api/cockpit/*` — cockpit proposals, timeline, recent activity.
- `/api/search/logs` — log full-text search.
- `/api/whiteboard` — mindmap node CRUD and AI generation.
- `/api/notes` — scratch notes.

### Engines

`apps/api/src/engines/` manages AI agent execution:

- `executors/index.ts` — registry of executors by `EngineType`.
- Supported executors:
  - `claude-code` (legacy Anthropic CLI)
  - `claude-code-sdk` (`@anthropic-ai/claude-agent-sdk`)
  - `codex` (OpenAI Codex CLI)
  - `acp` and `acp:${agent}` (Agent Client Protocol agents: Claude, Codex, Gemini, OpenCode)
- `engines/issue/` — the `IssueEngine` singleton, process lifecycle (spawn, settle, turn completion), orchestration (execute/follow-up/restart/cancel), persistence, streaming, token usage, and worktree handling.
- `engines/process-manager.ts` — generic process manager also used by terminal PTY sessions.

### Events

- `apps/api/src/events/event-bus.ts` — typed in-memory `AppEventBus`.
- `apps/api/src/events/issue-events.ts` — helpers for issue/log events.
- `apps/api/src/events/changes-summary.ts` — listens for `done` events and computes git diff summaries.
- `apps/api/src/routes/events.ts` — global SSE endpoint consumed by the frontend.

### Cron

`apps/api/src/cron/` uses `cronbake` to schedule persisted jobs from the `cronJobs` table. Builtin actions: `upload-cleanup`, `log-cleanup`, `issue-log-retention`, `worktree-cleanup`. Issue actions: `execute`, `follow-up`, `close`, `check-status`, `resolver`. Supports 5/6-field cron, `@every_*` shorthands, pause/resume, manual trigger, and delivery logs in `cronJobLogs`.

### Webhooks

`apps/api/src/routes/settings/webhooks.ts` plus `apps/api/src/webhooks/dispatcher.ts` handle outgoing webhooks and Telegram notifications. Events include `issue.created/updated/deleted`, `issue.status.{todo,working,review,done}`, and `session.started/completed/failed`. Deliveries are logged in `webhookDeliveries` with deduplication keys.

### Self-Upgrade

`apps/api/src/upgrade/` checks GitHub Releases, downloads updates, drains in-flight turns, and restarts. Works in both standalone binary mode and launcher/package mode (`data/app/v*`). Local package hot-reload is supported via `applyLocalVersion()`.

## Frontend Architecture

### Entry & Routing

`apps/frontend/src/main.tsx` creates a `QueryClient` (stale time 30s, retry 1, `refetchOnWindowFocus: false`, 24h gc time) wrapped in `PersistQueryClientProvider` (`localStorage` key `bkd:react-query-cache`). It sets up an SSE event bus, an `AuthGate`, global drawers/palette/toaster, and lazy-loaded routes:

- `/login`, `/login/callback` — auth flow
- `/` — `HomePage` (cockpit/dashboard)
- `/projects/:projectId` — `KanbanPage`
- `/projects/:projectId/issues`, `/projects/:projectId/issues/:issueId` — `IssueDetailPage`
- `/review`, `/review/:projectAlias/:issueId` — `ReviewPage`
- `/cron` — `CronPage`
- `/projects/:projectId/whiteboard` — `WhiteboardPage`
- `/workspace/new`, `/workspace/:wid` — workspace pages
- `/search` — `SearchPage`
- `*` — redirects to `/`

### State Management

- **React Query** (`apps/frontend/src/hooks/use-kanban.ts`) owns all server state. Query keys are hierarchical (`queryKeys` factory). `useBulkUpdateIssues` uses optimistic updates with rollback. Stale-time tiers live in `lib/query-config.ts`.
- **Zustand** owns local UI state. Stores include `board-store`, `panel-store`, `view-mode-store`, `bulk-selection-store`, `chat-filter-store`, `chat-search-store`, `dock-store`, `file-browser-store`, `notes-store`, `process-manager-store`, `terminal-session-store`, `terminal-store`, `scroll-position-store`, `server-store`, `diff-comments-store`.

### API Client

`apps/frontend/src/lib/kanban-api.ts` wraps the backend envelope format, adds auth headers, applies a 30s timeout, handles 401 redirects, and exposes typed helpers (`get`, `post`, `patch`, `put`, `del`, `postFormData`).

### Component Areas

- `components/ui/` — shadcn-style primitives (`Button`, `Dialog`, `Badge`, `Command`, `Sonner`, `StatusGlyph`, etc.) built on `@base-ui/react`.
- `components/kanban/` — board, columns, cards, sidebar, create-issue dialog.
- `components/issue-detail/` — chat body, chat input, session messages, diff panel, diff review, dock, terminal tab.
- `components/files/` — file browser, file viewer, code editor, markdown renderer.
- `components/terminal/` — xterm.js terminal view with tabs, themes, reconnect.
- `components/settings/` — settings sections (general, worktree, models, logs, cleanup, recycle bin, webhooks, upgrade, about).
- `components/cockpit/` — dashboard widgets.
- `components/whiteboard/` — mindmap canvas (`@xyflow/react`).
- `components/workspace/` — workspace views.
- `components/search/` — global search results.

### Styling

- Tailwind CSS v4 via `@tailwindcss/vite`.
- CSS variables follow the shadcn token model (`--primary`, `--accent-brand`, `--success`, `--warning`, `--error`, `--info`, `--neutral`, etc.).
- `cn()` in `lib/utils.ts` combines `clsx` + `tailwind-merge`.
- `class-variance-authority` is used for component variants.

### i18n

Translations live in `apps/frontend/src/i18n/en.json` and `zh.json`. Default language is read from `localStorage` (`i18n-lang`), falling back to `zh` then `en`. All user-facing strings must have keys in both files.

### Theme

`useTheme()` supports `light`, `dark`, `system` modes, persisted to `localStorage` (`kanban-theme`).

## Code Style & Conventions

- Lint/format via @antfu/eslint-config (`eslint.config.js` at root). No semicolons, single quotes, 2-space indent. `eslint` replaces Prettier.
- Use Bun APIs over Node.js equivalents (`Bun.file()`, `Bun.serve()`, `bun:sqlite`, `bun:test`).
- TypeScript strict mode, NodeNext/Bundler module resolution depending on workspace.
- Prefer `node:` prefix imports.
- Separate `import type` from value imports.
- Use `import * as z from 'zod'` for Zod.
- IDs use ULID/nanoid (not UUID).
- All tables use soft-delete (`isDeleted`) and `commonFields` (`createdAt`, `updatedAt`).
- All API routes must validate with Zod via `@hono/zod-validator`; do not use `c.req.json<T>()` for runtime validation.
- All route handlers must verify project existence and cross-project ownership before operating on scoped entities.
- Shared types live in `packages/shared/src/index.ts`; frontend re-exports via `apps/frontend/src/types/kanban.ts`.
- Add new API endpoints in `apps/frontend/src/lib/kanban-api.ts`, then wrap them in React Query hooks in `apps/frontend/src/hooks/use-kanban.ts`.
- All user-facing strings must be internationalized in both `en.json` and `zh.json`.

## Testing

- **Backend**: `bun:test` in `apps/api/test/`. Run `bun run test:api`. Preload (`test/preload.ts`) sets up an isolated test DB and mocks engines.
- **Frontend**: Vitest + jsdom + @testing-library/react. Run `bun run test:frontend`. Setup file is `src/test-setup.ts` (polyfills `matchMedia`, `ResizeObserver`, `scrollIntoView`). Coverage uses `@vitest/coverage-v8`.
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, test (API + frontend), and build jobs.

## Security Considerations

- Auth is optional JWT/Bearer token auth when `API_SECRET` is configured. Tokens are read from `Authorization` header or `?token=` query parameter.
- Secure headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) are applied globally.
- CORS is restricted by `ALLOWED_ORIGIN`.
- Filesystem routes enforce `ROOT_DIR` containment and reject symlink traversal outside the workspace.
- Webhook URLs are validated to prevent SSRF.
- `/api/runtime` is disabled unless `ENABLE_RUNTIME_ENDPOINT` is set.
- In production/package mode, static assets are embedded or served from `apps/frontend/dist` with SPA fallback; API routes under `/api/*` bypass the fallback.
- The launcher binary only downloads from `github.com`/`objects.githubusercontent.com`, verifies SHA-256 checksums, and caps downloads at 50 MB.

## Deployment & Distribution

Three distribution artifacts are produced:

1. **Full standalone binary** (`bun run compile` / `scripts/compile.ts --mode full`) — embeds frontend dist, migrations, and API into one executable.
2. **Launcher binary** (`bun run compile:launcher` / `scripts/compile.ts --mode launcher`) — a small binary that downloads and runs the latest app package from GitHub releases.
3. **App package** (`bun run package` / `scripts/package.ts`) — a ~1 MB tar.gz containing `server.js`, `public/`, `migrations/`, and `version.json`.

Release workflows (`.github/workflows/release.yml` and `.github/workflows/launcher.yml`) publish binaries and packages to GitHub Releases. There is no Docker or Makefile in the repository.

## Project Development Workflow

Use the `/pma` skill to manage project development with a strict three-phase workflow:

1. Investigation
2. Proposal
3. Implement → Verify → Record

Rules:

- Do not implement before explicit confirmation (`proceed` / `开始实现`).
- Track tasks in `docs/task/index.md` and `docs/task/PREFIX-NNN.md`.
- Track non-trivial plans in `docs/plan/index.md` and `docs/plan/PLAN-NNN.md`.
- Task IDs use `PREFIX-NNN` format (e.g. `AUTH-001`); never skip or reuse IDs.
- Before starting a task: claim it atomically (`[ ] -> [-]` in index, set detail `status: in_progress`, set `owner`).
- On completion: set task index marker to `[x]` and detail `status: completed`.
- Keep status updates immediate; do not defer synchronization.

## Useful References

- `README.md` — user-facing overview, installation, system requirements, configuration.
- `DESIGN.md` — design constitution (visual, interaction, component/layout, motion systems).
- `CLAUDE.md` — original agent guidance (overlaps with this file; kept as a sibling reference).
- `docs/architecture.md` — detailed architecture covering runtime, database, engine system, cron, events, webhooks, MCP, upgrade, frontend state, and deployment.
- `docs/development.md` — development setup, conventions, and end-to-end guide for adding an API endpoint.
- `docs/api/*.md` — API endpoint documentation.
- `skills/bkd/SKILL.md` and `skills/bkd/references/rest-api.md` — BKD skill for operating a server over REST.
- `.env.example` — full environment variable template.
