import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, expectError, expectSuccess, post } from './helpers'
import './setup'

/**
 * WT-001 — worktree base branch + custom branch name on issue create.
 */

interface IssueWithWorktree {
  useWorktree: boolean
  worktreeBaseBranch?: string | null
  worktreeBranchName?: string | null
}

let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('WT Options Project')
})

describe('POST /api/projects/:projectId/issues — worktree options', () => {
  test('persists base branch and custom branch name', async () => {
    const res = await post<IssueWithWorktree>(`/api/projects/${projectId}/issues`, {
      title: 'wt issue',
      statusId: 'todo',
      useWorktree: true,
      worktreeBaseBranch: 'develop',
      worktreeBranchName: 'feature/my-thing',
    })
    expect(res.status).toBe(201)
    const data = expectSuccess(res)
    expect(data.useWorktree).toBe(true)
    expect(data.worktreeBaseBranch).toBe('develop')
    expect(data.worktreeBranchName).toBe('feature/my-thing')
  })

  test('rejects an invalid branch name', async () => {
    const res = await post(`/api/projects/${projectId}/issues`, {
      title: 'bad branch',
      statusId: 'todo',
      useWorktree: true,
      worktreeBranchName: 'bad branch!',
    })
    expectError(res, 400)
  })

  test('defaults the worktree options to null when omitted', async () => {
    const res = await post<IssueWithWorktree>(`/api/projects/${projectId}/issues`, {
      title: 'no wt opts',
      statusId: 'todo',
    })
    const data = expectSuccess(res)
    expect(data.worktreeBaseBranch ?? null).toBeNull()
    expect(data.worktreeBranchName ?? null).toBeNull()
  })
})
