import { describe, expect, test } from 'bun:test'
import { expectError, expectSuccess, get, patch } from './helpers'
/**
 * Settings API tests.
 */
import './setup'

describe('GET /api/settings/workspace-path', () => {
  test('returns current workspace path', async () => {
    const result = await get<{ path: string }>('/api/settings/workspace-path')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(typeof data.path).toBe('string')
    // Default path is '/' when no setting has been saved
    expect(data.path).toBeTruthy()
  })
})

describe('PATCH /api/settings/workspace-path', () => {
  test('sets a valid workspace path', async () => {
    const result = await patch<{ path: string }>('/api/settings/workspace-path', {
      path: '/tmp',
    })
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.path).toBe('/tmp')
  })

  test('persists workspace path across reads', async () => {
    // Set path
    await patch<{ path: string }>('/api/settings/workspace-path', {
      path: '/tmp',
    })
    // Read it back
    const result = await get<{ path: string }>('/api/settings/workspace-path')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.path).toBe('/tmp')
  })

  test('rejects non-existent path', async () => {
    const result = await patch<unknown>('/api/settings/workspace-path', {
      path: '/nonexistent/path/that/does/not/exist',
    })
    expect(result.status).toBe(400)
    expectError(result, 400)
  })

  test('rejects empty path', async () => {
    const result = await patch<unknown>('/api/settings/workspace-path', {
      path: '',
    })
    expect(result.status).toBe(400)
  })

  test('rejects missing path field', async () => {
    const result = await patch<unknown>('/api/settings/workspace-path', {})
    expect(result.status).toBe(400)
  })
})

describe('GET /api/settings/worktree', () => {
  test('returns all worktree settings with defaults', async () => {
    const result = await get<import('@bkd/shared').WorktreeSettings>('/api/settings/worktree')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.fetchStrategy).toBe('auto')
    expect(data.branchTemplate).toBe('bkd/{slug}-{id}')
    expect(data.initSubmodules).toBe(true)
    expect(data.deleteBranchDefault).toBe(false)
    expect(typeof data.worktreeRoot).toBe('string')
    expect(data.worktreeRoot).toBeTruthy()
  })
})

describe('PATCH /api/settings/worktree', () => {
  test('updates writable fields and reads them back', async () => {
    const result = await patch<import('@bkd/shared').WorktreeSettings>('/api/settings/worktree', {
      fetchStrategy: 'always',
      defaultBaseBranch: '  develop  ',
      branchTemplate: 'wip/{repo}-{slug}-{id}',
      initSubmodules: false,
      deleteBranchDefault: true,
      setupScript: 'echo hi',
    })
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.fetchStrategy).toBe('always')
    expect(data.defaultBaseBranch).toBe('develop') // trimmed
    expect(data.branchTemplate).toBe('wip/{repo}-{slug}-{id}')
    expect(data.initSubmodules).toBe(false)
    expect(data.deleteBranchDefault).toBe(true)
    expect(data.setupScript).toBe('echo hi')
  })

  test('rejects branch template missing {id}', async () => {
    const result = await patch<unknown>('/api/settings/worktree', {
      branchTemplate: 'bkd/{slug}',
    })
    expect(result.status).toBe(400)
  })

  test('rejects branch template with unsafe chars', async () => {
    const result = await patch<unknown>('/api/settings/worktree', {
      branchTemplate: 'bkd/{slug} {id}',
    })
    expect(result.status).toBe(400)
  })

  test('rejects empty branch template', async () => {
    const result = await patch<unknown>('/api/settings/worktree', {
      branchTemplate: '',
    })
    expect(result.status).toBe(400)
  })

  test('rejects invalid fetch strategy', async () => {
    const result = await patch<unknown>('/api/settings/worktree', {
      fetchStrategy: 'bogus',
    })
    expect(result.status).toBe(400)
  })

  test('rejects empty body', async () => {
    const result = await patch<unknown>('/api/settings/worktree', {})
    expect(result.status).toBe(400)
  })
})
