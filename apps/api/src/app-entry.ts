export { createApp } from './app'
export { createCore } from './app-core'
export { setEngine } from './engines/issue/engine-ref'
export { setBus } from './events/bus-ref'
// The launcher loads this bundle in a SEPARATE module graph, which gives it its
// own issueEngine singleton. Export the lifecycle entrypoints so the launcher
// can run them against THIS bundle's engine (the one that actually executes
// issues) instead of its own compiled-in copy — otherwise the reconciler/cron
// run on an engine whose ProcessManager is always empty and mark every running
// issue as failed.
export { initLauncher, registerUpgradeShutdown } from './launcher-init'
// The launcher owns Bun.serve and must wire Hono's Bun WebSocket handler from
// THIS bundle (same module graph as the routes' upgradeWebSocket). Without it
// every WS upgrade — terminal, etc. — fails with
// "To enable websocket support, set the websocket object in Bun.serve({})".
export { websocket } from 'hono/bun'
