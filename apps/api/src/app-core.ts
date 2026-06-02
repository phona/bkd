import { IssueEngine } from '@/engines/issue/engine'
import { setEngine } from '@/engines/issue/engine-ref'
import { setBus } from '@/events/bus-ref'
import { AppEventBus } from '@/events/event-bus'
import type { LauncherStops } from '@/launcher-init'
import { initEngineLifecycle, initProcessGuards } from '@/launcher-init'

export interface Core {
  stops: LauncherStops
  engine: IssueEngine
  events: AppEventBus
}

/**
 * Build the single, long-lived engine and start its lifecycle. Call ONCE per
 * process (the launcher). The engine is registered in the accessor so every
 * consumer (routes via getEngine, background tasks) shares this instance, and it
 * is never recreated on a route hot-reload.
 *
 * The persistent engine + bus are returned so the launcher can re-inject them
 * into a NEW bundle's accessors on a route hot-reload (a fresh module graph
 * starts with empty accessor holders). DO NOT call createCore again on reload.
 */
export function createCore(): Core {
  initProcessGuards()
  // Bus before the engine: engine construction may emit events.
  const events = new AppEventBus()
  setBus(events)
  const engine = new IssueEngine()
  setEngine(engine)
  const stops = initEngineLifecycle()
  return { stops, engine, events }
}
