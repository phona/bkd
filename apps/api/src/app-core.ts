import { IssueEngine } from '@/engines/issue/engine'
import { setEngine } from '@/engines/issue/engine-ref'
import type { LauncherStops } from '@/launcher-init'
import { initEngineLifecycle, initProcessGuards } from '@/launcher-init'

export interface Core { stops: LauncherStops }

/**
 * Build the single, long-lived engine and start its lifecycle. Call ONCE per
 * process (the launcher). The engine is registered in the accessor so every
 * consumer (routes via getEngine, background tasks) shares this instance, and it
 * is never recreated on a route hot-reload.
 */
export function createCore(): Core {
  initProcessGuards()
  setEngine(new IssueEngine())
  const stops = initEngineLifecycle()
  return { stops }
}
