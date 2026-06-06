import { describe, expect, test } from 'bun:test'
import process from 'node:process'
import { killPty } from '@/routes/terminal'
import { ROOT_DIR } from '@/root'
import { expectError, expectSuccess, get, post } from './helpers'
import './setup'

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function spawnPty() {
  return (Bun as any).spawn(['/bin/bash', '-l'], {
    terminal: { cols: 80, rows: 24, data() {} },
    cwd: process.env.HOME || '/',
    env: { ...process.env, TERM: 'xterm-256color' },
  })
}

describe('terminal lifecycle', () => {
  test('killPty actually terminates the spawned PTY shell', async () => {
    const proc = spawnPty()
    const pid = proc.pid as number
    await new Promise(r => setTimeout(r, 200))
    expect(alive(pid)).toBe(true)

    killPty(proc)

    await Promise.race([proc.exited, new Promise(r => setTimeout(r, 2000))])
    await new Promise(r => setTimeout(r, 200))
    expect(alive(pid)).toBe(false)
  })

  test('unattached session is reaped after the unattached timeout', async () => {
    process.env.BKD_TERMINAL_UNATTACHED_MS = '300'
    try {
      const created = await post<{ id: string }>('/api/terminal', {})
      const { id } = expectSuccess(created)

      // Alive immediately after creation.
      const immediately = await get(`/api/terminal/${id}`)
      expect(immediately.status).toBe(200)

      // No WS ever attaches — the reaper must kill it past the timeout.
      await new Promise(r => setTimeout(r, 700))
      const after = await get(`/api/terminal/${id}`)
      expect(after.status).toBe(404)
    } finally {
      delete process.env.BKD_TERMINAL_UNATTACHED_MS
    }
  })
})

describe('terminal cwd', () => {
  test('rejects a cwd outside the allowlist with 400', async () => {
    const res = await post('/api/terminal', { cwd: '/etc' })
    expectError(res, 400)
  })

  test('accepts a cwd inside the app root', async () => {
    process.env.BKD_TERMINAL_UNATTACHED_MS = '300'
    try {
      const res = await post<{ id: string }>('/api/terminal', { cwd: ROOT_DIR })
      const { id } = expectSuccess(res)
      expect(typeof id).toBe('string')
      // Let the unattached reaper clean it up (no WS attaches in this test).
      await new Promise(r => setTimeout(r, 500))
    } finally {
      delete process.env.BKD_TERMINAL_UNATTACHED_MS
    }
  })
})
