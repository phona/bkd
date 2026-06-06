import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { resolveTerminalCwd } from '@/routes/terminal-cwd'
import { ROOT_DIR } from '@/root'
import './setup'

describe('resolveTerminalCwd', () => {
  test('returns null for empty input (caller falls back to HOME)', () => {
    expect(resolveTerminalCwd(undefined)).toBeNull()
    expect(resolveTerminalCwd('')).toBeNull()
    expect(resolveTerminalCwd('   ')).toBeNull()
  })

  test('allows the app root and paths inside it', () => {
    expect(resolveTerminalCwd(ROOT_DIR)).toBe(realpathSync(ROOT_DIR))
    const inside = resolve(ROOT_DIR, 'apps')
    expect(resolveTerminalCwd(inside)).toBe(realpathSync(inside))
  })

  test('rejects paths outside every allowed root', () => {
    // /etc is not under ROOT_DIR / worktree base / any project dir.
    expect(resolveTerminalCwd('/etc')).toBeNull()
  })

  test('rejects traversal that escapes an allowed root', () => {
    // Resolves above ROOT_DIR and out of the allowlist.
    expect(resolveTerminalCwd(join(ROOT_DIR, '..', '..', '..', '..'))).toBeNull()
  })

  test('rejects a non-existent path', () => {
    expect(resolveTerminalCwd(join(tmpdir(), 'bkd-does-not-exist-xyz'))).toBeNull()
  })

  test('rejects a real directory that is not an allowed root', () => {
    const stray = mkdtempSync(join(tmpdir(), 'bkd-stray-'))
    expect(resolveTerminalCwd(stray)).toBeNull()
  })
})
