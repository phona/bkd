import { sqlite } from '@/db'
import { logger } from '@/logger'
import { MAX_CONCURRENT_EXECUTIONS } from './constants'

export const MAX_CONCURRENT_KEY = 'engine:maxConcurrentExecutions'

/**
 * Synchronously read the persisted max-concurrent setting straight from SQLite
 * (bun:sqlite is synchronous) so a freshly-constructed engine starts at the
 * configured limit immediately — with NO window where the gate is the default
 * before the async `initMaxConcurrent()` DB read lands. Falls back to the
 * compile-time default when the setting is absent or invalid.
 */
export function readInitialMaxConcurrent(): number {
  try {
    const row = sqlite
      .query('SELECT value FROM app_settings WHERE key = ?')
      .get(MAX_CONCURRENT_KEY) as { value?: string } | null
    const n = row?.value != null ? Number(row.value) : Number.NaN
    if (Number.isFinite(n) && n >= 1) return n
  } catch (err) {
    logger.warn({ err }, 'read_initial_max_concurrent_failed')
  }
  return MAX_CONCURRENT_EXECUTIONS
}
