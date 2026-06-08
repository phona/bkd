import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupWorktree,
  createWorktree,
  deleteBranch,
  deriveWorktreeBranch,
  removeWorktree,
  resolveWorktreePath,
} from '@/engines/issue/utils/worktree'
import { setAppSetting } from '@/db/helpers'
import { spawnNodeSync } from '@/engines/spawn'
import { ROOT_DIR } from '@/root'
import {
  validateBranchTemplate,
  WORKTREE_BRANCH_TEMPLATE_KEY,
} from '@/routes/settings/worktree-keys'

describe('validateBranchTemplate', () => {
  test('accepts the default template', () => {
    expect(validateBranchTemplate('bkd/{slug}-{id}')).toBeNull()
  })
  test('rejects a template without {id}', () => {
    expect(validateBranchTemplate('bkd/{slug}')).toBeTruthy()
  })
  test('rejects an empty template', () => {
    expect(validateBranchTemplate('  ')).toBeTruthy()
  })
  test('rejects unsafe characters', () => {
    expect(validateBranchTemplate('bkd/{slug} {id}')).toBeTruthy()
    expect(validateBranchTemplate('bkd/{id}:x')).toBeTruthy()
    expect(validateBranchTemplate('bkd/{id}~x')).toBeTruthy()
  })
})

describe('deriveWorktreeBranch (template — PLAN-039)', () => {
  test('default template reproduces historical output', async () => {
    expect(await deriveWorktreeBranch('Fix login bug', 'iioianio')).toBe('bkd/fix-login-bug-iioianio')
  })
  test('CJK/emoji-only title collapses to bkd/{id}', async () => {
    expect(await deriveWorktreeBranch('修复登录态', 'iioianio')).toBe('bkd/iioianio')
  })
  test('honors a custom template with {repo}', async () => {
    await setAppSetting(WORKTREE_BRANCH_TEMPLATE_KEY, 'wip/{repo}/{slug}-{id}')
    try {
      expect(await deriveWorktreeBranch('Add Feature', 'abc123', '/tmp/my-repo')).toBe(
        'wip/my-repo/add-feature-abc123',
      )
    } finally {
      await setAppSetting(WORKTREE_BRANCH_TEMPLATE_KEY, 'bkd/{slug}-{id}')
    }
  })
  test('falls back to bkd/{id} when stored template lacks {id}', async () => {
    await setAppSetting(WORKTREE_BRANCH_TEMPLATE_KEY, 'bkd/{slug}')
    try {
      expect(await deriveWorktreeBranch('Whatever', 'zzz999')).toBe('bkd/whatever-zzz999')
    } finally {
      await setAppSetting(WORKTREE_BRANCH_TEMPLATE_KEY, 'bkd/{slug}-{id}')
    }
  })
})

/**
 * Worktree utility tests — verifies:
 * 1. resolveWorktreePath returns deterministic path under ROOT_DIR/data/worktrees/
 * 2. createWorktree creates a git worktree and returns its path
 * 3. removeWorktree removes the git worktree and cleans up the directory
 * 4. removeWorktree falls back to directory deletion when git command fails
 * 5. cleanupWorktree calls removeWorktree (fire-and-forget)
 *
 * These tests use the actual git repo since worktree operations require it.
 */

let gitRoot = ''
const TEST_PROJECT_ID = `test-project-${Date.now()}`
const issueIds: string[] = []

function makeIssueId(prefix = 'test-wt'): string {
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  issueIds.push(id)
  return id
}

function gitSync(args: string[], cwd: string): void {
  spawnNodeSync(['git', ...args], { cwd })
}

beforeAll(() => {
  gitRoot = mkdtempSync(join(tmpdir(), 'bkd-worktree-repo-'))
  gitSync(['init'], gitRoot)
  gitSync(['config', 'user.email', 'test@example.com'], gitRoot)
  gitSync(['config', 'user.name', 'BitK Test'], gitRoot)

  writeFileSync(join(gitRoot, 'README.md'), 'test repo\n')
  gitSync(['add', '.'], gitRoot)
  gitSync(['commit', '-m', 'init'], gitRoot)
})

afterAll(() => {
  // Clean up any leftover worktrees and branches created by tests
  for (const issueId of issueIds) {
    const wtDir = resolveWorktreePath(TEST_PROJECT_ID, issueId)
    try {
      if (existsSync(wtDir)) {
        gitSync(['worktree', 'remove', '--force', wtDir], gitRoot)
      }
    } catch {
      /* best effort */
    }
    try {
      gitSync(['branch', '-D', `bkd/${issueId}`], gitRoot)
    } catch {
      /* best effort */
    }
  }

  // Clean up the test project directory under data/worktrees/
  try {
    const projectDir = join(ROOT_DIR, 'data/worktrees', TEST_PROJECT_ID)
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true })
    }
  } catch {
    /* best effort */
  }

  try {
    if (gitRoot && existsSync(gitRoot)) {
      rmSync(gitRoot, { recursive: true, force: true })
    }
  } catch {
    /* best effort */
  }
})

describe('resolveWorktreePath', () => {
  test('returns deterministic path under ROOT_DIR/worktrees/', () => {
    const path = resolveWorktreePath('proj-1', 'issue-abc')
    expect(path).toBe(join(ROOT_DIR, 'worktrees', 'proj-1', 'issue-abc'))
  })
})

describe('createWorktree', () => {
  test('creates a worktree directory with the expected path', async () => {
    const issueId = makeIssueId('create')
    const worktreeDir = await createWorktree(gitRoot, TEST_PROJECT_ID, issueId)
    expect(worktreeDir).toBe(resolveWorktreePath(TEST_PROJECT_ID, issueId))
    expect(existsSync(worktreeDir)).toBe(true)

    // Verify it's a valid git worktree (has .git file)
    expect(existsSync(join(worktreeDir, '.git'))).toBe(true)
  })

  test('retries with existing branch on second call', async () => {
    const issueId = makeIssueId('retry')
    const firstDir = await createWorktree(gitRoot, TEST_PROJECT_ID, issueId)
    expect(existsSync(firstDir)).toBe(true)
    await removeWorktree(gitRoot, firstDir)

    const worktreeDir = await createWorktree(gitRoot, TEST_PROJECT_ID, issueId)
    expect(existsSync(worktreeDir)).toBe(true)
  })

  // Regression: repos using release/develop (no main/master) must still get
  // an isolated worktree instead of silently falling back to the shared dir.
  function makeRepoOnBranch(branch: string): string {
    const repo = mkdtempSync(join(tmpdir(), 'bkd-wt-branch-'))
    gitSync(['init'], repo)
    gitSync(['config', 'user.email', 'test@example.com'], repo)
    gitSync(['config', 'user.name', 'BitK Test'], repo)
    writeFileSync(join(repo, 'README.md'), 'x\n')
    gitSync(['add', '.'], repo)
    gitSync(['commit', '-m', 'init'], repo)
    gitSync(['branch', '-m', branch], repo)
    return repo
  }

  test('creates a worktree in a repo whose default branch is release', async () => {
    const repo = makeRepoOnBranch('release')
    const issueId = makeIssueId('release')
    const wtDir = await createWorktree(repo, TEST_PROJECT_ID, issueId)
    expect(existsSync(wtDir)).toBe(true)
    rmSync(repo, { recursive: true, force: true })
  })

  test('falls back to HEAD when no known default branch name exists', async () => {
    const repo = makeRepoOnBranch('feature/some-work')
    const issueId = makeIssueId('headfallback')
    const wtDir = await createWorktree(repo, TEST_PROJECT_ID, issueId)
    expect(existsSync(wtDir)).toBe(true)
    rmSync(repo, { recursive: true, force: true })
  })
})

describe('removeWorktree', () => {
  test('removes worktree via git command', async () => {
    const issueId = makeIssueId('remove')
    const wtDir = await createWorktree(gitRoot, TEST_PROJECT_ID, issueId)
    expect(existsSync(wtDir)).toBe(true)

    await removeWorktree(gitRoot, wtDir)
    expect(existsSync(wtDir)).toBe(false)
  })

  test('falls back to directory deletion for non-git worktree dirs', async () => {
    const fakeDir = join(ROOT_DIR, 'worktrees', TEST_PROJECT_ID, 'fake-worktree')
    mkdirSync(fakeDir, { recursive: true })
    writeFileSync(join(fakeDir, 'test.txt'), 'test')
    expect(existsSync(fakeDir)).toBe(true)

    await removeWorktree(gitRoot, fakeDir)
    expect(existsSync(fakeDir)).toBe(false)
  })
})

describe('createWorktree attachExisting', () => {
  test('checks out an existing branch without creating a new one', async () => {
    const issueId = makeIssueId('attach')
    // Pre-create a branch on the repo to attach to.
    const branch = `existing-${issueId}`
    gitSync(['branch', branch], gitRoot)

    const wtDir = await createWorktree(gitRoot, TEST_PROJECT_ID, issueId, {
      branchNameOverride: branch,
      attachExisting: true,
    })
    expect(existsSync(wtDir)).toBe(true)

    // The worktree HEAD should be on the attached branch, not bkd/{issueId}.
    const head = spawnNodeSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wtDir })
    expect(head.stdout.trim()).toBe(branch)

    await removeWorktree(gitRoot, wtDir)
    gitSync(['branch', '-D', branch], gitRoot)
  })

  test('fails when the existing branch does not exist', async () => {
    const issueId = makeIssueId('attach-missing')
    await expect(
      createWorktree(gitRoot, TEST_PROJECT_ID, issueId, {
        branchNameOverride: 'does-not-exist-branch',
        attachExisting: true,
      }),
    ).rejects.toThrow()
  })
})

describe('deleteBranch', () => {
  test('deletes a local branch', async () => {
    const branch = `to-delete-${Date.now()}`
    gitSync(['branch', branch], gitRoot)
    await deleteBranch(gitRoot, branch, true)
    const res = spawnNodeSync(
      ['git', 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      { cwd: gitRoot },
    )
    expect(res.exitCode).not.toBe(0)
  })

  test('is idempotent for a missing branch', async () => {
    await expect(deleteBranch(gitRoot, 'never-existed-branch', true)).resolves.toBeUndefined()
  })
})

describe('cleanupWorktree', () => {
  test('calls removeWorktree as fire-and-forget', async () => {
    const cleanupIssueId = makeIssueId('cleanup')
    const wtDir = await createWorktree(gitRoot, TEST_PROJECT_ID, cleanupIssueId)

    expect(existsSync(wtDir)).toBe(true)

    // cleanupWorktree is fire-and-forget — pass baseDir explicitly
    cleanupWorktree(gitRoot, cleanupIssueId, wtDir)

    // Wait for the async cleanup to complete
    await new Promise(r => setTimeout(r, 1000))

    expect(existsSync(wtDir)).toBe(false)

    // Clean up branch
    gitSync(['branch', '-D', `bkd/${cleanupIssueId}`], gitRoot)
  })
})
