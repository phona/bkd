export { createApp } from './app'
export { createCore } from './core'
// The launcher loads this bundle in a SEPARATE module graph, which gives it its
// own issueEngine singleton. Export the lifecycle entrypoints so the launcher
// can run them against THIS bundle's engine (the one that actually executes
// issues) instead of its own compiled-in copy — otherwise the reconciler/cron
// run on an engine whose ProcessManager is always empty and mark every running
// issue as failed.
export { initLauncher, registerUpgradeShutdown } from './launcher-init'
