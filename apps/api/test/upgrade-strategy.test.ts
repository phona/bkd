import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'bun:test'
import { decideUpgradeStrategy } from '@/upgrade/strategy'

// Hermetic fixtures: build fake version dirs under a temp root, each with a
// version.json (optional engineCoreHash) and a migrations/ dir of .sql files.
const TMP = resolve(import.meta.dir, '.tmp-upgrade-strategy')

function makeVersionDir(
  name: string,
  opts: { engineCoreHash?: string, migrations?: string[] } = {},
): string {
  const dir = resolve(TMP, name)
  const migDir = resolve(dir, 'migrations')
  mkdirSync(migDir, { recursive: true })
  const vj: Record<string, unknown> = { version: name, commit: 'test' }
  if (opts.engineCoreHash !== undefined) vj.engineCoreHash = opts.engineCoreHash
  writeFileSync(resolve(dir, 'version.json'), JSON.stringify(vj))
  writeFileSync(resolve(dir, 'server.js'), '// fake')
  for (const m of opts.migrations ?? []) writeFileSync(resolve(migDir, m), '-- sql')
  return dir
}

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

describe('decideUpgradeStrategy', () => {
  it('hot-reloadable when engine hash + migration set are identical', () => {
    const cur = makeVersionDir('a-cur', { engineCoreHash: 'h1', migrations: ['0001.sql', '0002.sql'] })
    const nxt = makeVersionDir('a-nxt', { engineCoreHash: 'h1', migrations: ['0001.sql', '0002.sql'] })
    const r = decideUpgradeStrategy(cur, nxt)
    expect(r.hotReloadable).toBe(true)
  })

  it('requires restart when the new bundle adds a migration', () => {
    const cur = makeVersionDir('b-cur', { engineCoreHash: 'h1', migrations: ['0001.sql'] })
    const nxt = makeVersionDir('b-nxt', { engineCoreHash: 'h1', migrations: ['0001.sql', '0002.sql'] })
    const r = decideUpgradeStrategy(cur, nxt)
    expect(r.hotReloadable).toBe(false)
    expect(r.reason).toMatch(/migration/i)
    expect(r.reason).toContain('0002.sql')
  })

  it('requires restart when the engine-core hash differs', () => {
    const cur = makeVersionDir('c-cur', { engineCoreHash: 'h1', migrations: ['0001.sql'] })
    const nxt = makeVersionDir('c-nxt', { engineCoreHash: 'h2-changed', migrations: ['0001.sql'] })
    const r = decideUpgradeStrategy(cur, nxt)
    expect(r.hotReloadable).toBe(false)
    expect(r.reason).toMatch(/engine/i)
  })

  it('requires restart (conservative) when either hash is missing', () => {
    const curNoHash = makeVersionDir('d-cur', { migrations: ['0001.sql'] })
    const nxt = makeVersionDir('d-nxt', { engineCoreHash: 'h1', migrations: ['0001.sql'] })
    expect(decideUpgradeStrategy(curNoHash, nxt).hotReloadable).toBe(false)

    const cur = makeVersionDir('d2-cur', { engineCoreHash: 'h1', migrations: ['0001.sql'] })
    const nxtNoHash = makeVersionDir('d2-nxt', { migrations: ['0001.sql'] })
    expect(decideUpgradeStrategy(cur, nxtNoHash).hotReloadable).toBe(false)
  })

  it('requires restart when there is no current baseline', () => {
    const nxt = makeVersionDir('e-nxt', { engineCoreHash: 'h1', migrations: ['0001.sql'] })
    const r = decideUpgradeStrategy(null, nxt)
    expect(r.hotReloadable).toBe(false)
    expect(r.reason).toMatch(/baseline|current/i)
  })

  it('removing a migration (rare) does not block hot-reload by itself', () => {
    // Only NEW migrations in the target require a restart; a smaller set does not.
    const cur = makeVersionDir('f-cur', { engineCoreHash: 'h1', migrations: ['0001.sql', '0002.sql'] })
    const nxt = makeVersionDir('f-nxt', { engineCoreHash: 'h1', migrations: ['0001.sql'] })
    expect(decideUpgradeStrategy(cur, nxt).hotReloadable).toBe(true)
  })
})
