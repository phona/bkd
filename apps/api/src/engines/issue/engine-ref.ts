import type { IssueEngine } from './engine'

let current: IssueEngine | undefined

/** Inject the process-wide engine instance (called once at boot by the core). */
export function setEngine(engine: IssueEngine): void {
  current = engine
}

/**
 * The single engine instance for this process. Lazily creates a default one
 * (dev / tests / Stage-1) so behaviour is unchanged before the launcher owns it.
 */
export function getEngine(): IssueEngine {
  if (!current) {
    // Lazy require avoids a load-order cycle with engine.ts (which will import
    // this module in a later task). A sync `import` would risk a circular load.
    const { IssueEngine } = require('./engine') as typeof import('./engine')
    current = new IssueEngine()
  }
  return current
}
