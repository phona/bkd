import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorktree, resolveWorktreePath } from '@/engines/issue/utils/worktree'
import { spawnNodeSync } from '@/engines/spawn'
import { expectSuccess, post } from './helpers'
import './setup'

/**
 * PLAN-038 — explicit worktree lifecycle endpoints (clean / recreate).
 * Uses a real temp git repo as the project directory so the endpoints can
 * actually remove + recreate a worktree on disk.
 */

interface IssueShape {
  id: string
  worktreeState?: 'none' | 'active' | 'cleaned'
}

let gitRoot = ''
let projectId = ''
let issueId = ''

function gitSync(args: string[], cwd: string) {
  return spawnNodeSync(['git', ...args], { cwd })
}

function branchExists(branch: string): boolean {
  const res = gitSync(
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    gitRoot,
  )
  return res.exitCode === 0
}

beforeAll(async () => {
  gitRoot = mkdtempSync(join(tmpdir(), 'bkd-wt-lifecycle-'))
  gitSync(['init'], gitRoot)
  gitSync(['config', 'user.email', 'test@example.com'], gitRoot)
  gitSync(['config', 'user.name', 'BitK Test'], gitRoot)
  writeFileSync(join(gitRoot, 'README.md'), 'test\n')
  gitSync(['add', '.'], gitRoot)
  gitSync(['commit', '-m', 'init'], gitRoot)

  const proj = await post<{ id: string }>('/api/projects', {
    name: 'WT Lifecycle Project',
    directory: gitRoot,
  })
  projectId = expectSuccess(proj).id

  const issue = await post<IssueShape>(`/api/projects/${projectId}/issues`, {
    title: 'lifecycle issue',
    statusId: 'todo',
    useWorktree: true,
  })
  issueId = expectSuccess(issue).id

  // Materialize the worktree on disk (branch defaults to bkd/{issueId}).
  await createWorktree(gitRoot, projectId, issueId)
})

afterAll(() => {
  const wtDir = resolveWorktreePath(projectId, issueId)
  try {
    if (existsSync(wtDir)) gitSync(['worktree', 'remove', '--force', wtDir], gitRoot)
  } catch { /* best effort */ }
  try {
    if (gitRoot && existsSync(gitRoot)) rmSync(gitRoot, { recursive: true, force: true })
  } catch { /* best effort */ }
})

describe('POST /worktree/clean', () => {
  test('removes the dir, keeps the branch, flips state to cleaned', async () => {
    const wtDir = resolveWorktreePath(projectId, issueId)
    expect(existsSync(wtDir)).toBe(true)

    const res = await post<IssueShape>(
      `/api/projects/${projectId}/issues/${issueId}/worktree/clean`,
      { force: false },
    )
    const data = expectSuccess(res)
    expect(data.worktreeState).toBe('cleaned')
    expect(existsSync(wtDir)).toBe(false)
    // Branch is kept so it can be re-pulled.
    expect(branchExists(`bkd/${issueId}`)).toBe(true)
  })
})

describe('POST /worktree/recreate', () => {
  test('re-materializes the dir and flips state back to active', async () => {
    const wtDir = resolveWorktreePath(projectId, issueId)
    const res = await post<IssueShape>(
      `/api/projects/${projectId}/issues/${issueId}/worktree/recreate`,
      {},
    )
    const data = expectSuccess(res)
    expect(data.worktreeState).toBe('active')
    expect(existsSync(wtDir)).toBe(true)
  })
})
