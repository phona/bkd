import { getBus, setBus } from './bus-ref'
import { AppEventBus } from './event-bus'

/** Global application event bus — single source of truth for all events. */
const appEventsInstance = new AppEventBus()
setBus(appEventsInstance)

/** @deprecated temporary bridge — use getBus() instead. */
export const appEvents = appEventsInstance

export { getBus, setBus }
export { AppEventBus } from './event-bus'
