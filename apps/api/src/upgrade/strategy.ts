import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Decision on how to apply an already-installed app package.
 *
 * Hot-reload only swaps the route object; the engine + event-bus instances and
 * any in-flight subprocesses persist (see scripts/launcher.ts `hotReloadApp`).
 * That makes hot-reload UNSAFE for two classes of change:
 *
 *  1. New DB migrations — migrations run only at launcher boot, never on a
 *     route swap, so the running schema would not match the new code.
 *  2. Engine-core changes — the persistent IssueEngine / AppEventBus / lifecycle
 *     instances keep running the OLD code after a swap, so the change would not
 *     take effect until a restart anyway.
 *
 * `engineCoreHash` (written into version.json by scripts/package.ts) covers the
 * second class; the migrations/ dir listing covers the first.
 */
export interface UpgradeStrategy {
  hotReloadable: boolean
  reason: string
}

function readEngineCoreHash(versionDir: string): string | null {
  try {
    const raw = readFileSync(resolve(versionDir, 'version.json'), 'utf8')
    const data = JSON.parse(raw) as { engineCoreHash?: unknown }
    return typeof data.engineCoreHash === 'string' && data.engineCoreHash.length > 0
      ? data.engineCoreHash
      : null
  } catch {
    return null
  }
}

function listMigrationSqlNames(versionDir: string): string[] {
  const dir = resolve(versionDir, 'migrations')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.sql'))
      .map(e => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Decide whether `newVersionDir` can be hot-reloaded over `currentVersionDir`,
 * or whether a graceful-drain restart is required. Conservative by design: any
 * uncertainty (missing baseline, missing hash) resolves to a restart.
 */
export function decideUpgradeStrategy(
  currentVersionDir: string | null,
  newVersionDir: string,
): UpgradeStrategy {
  if (!currentVersionDir || !existsSync(currentVersionDir)) {
    return { hotReloadable: false, reason: 'no current-version baseline to compare; restarting to be safe' }
  }

  // 1. New migrations in the target require a boot-time migration → restart.
  const curMigs = new Set(listMigrationSqlNames(currentVersionDir))
  const newMigs = listMigrationSqlNames(newVersionDir).filter(m => !curMigs.has(m))
  if (newMigs.length > 0) {
    return { hotReloadable: false, reason: `new DB migration(s): ${newMigs.join(', ')}` }
  }

  // 2. Engine-core change → the persistent engine/bus would keep old code → restart.
  const curHash = readEngineCoreHash(currentVersionDir)
  const newHash = readEngineCoreHash(newVersionDir)
  if (!curHash || !newHash) {
    return { hotReloadable: false, reason: 'engine-core hash unavailable on one side; restarting to be safe' }
  }
  if (curHash !== newHash) {
    return { hotReloadable: false, reason: 'engine-core changed (hash mismatch)' }
  }

  return { hotReloadable: true, reason: 'routes/frontend/API only — safe to hot-reload' }
}
