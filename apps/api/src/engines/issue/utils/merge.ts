import { runCommand } from '@/engines/spawn'

// Merge an issue's worktree branch back into the repo's checked-out branch
// (PLAN-030 / WT-003). Conservative by design: it refuses unsafe states and
// never leaves the working tree half-merged, so "land my changes" can't quietly
// corrupt the user's repo.

export type MergeStatus = 'merged' | 'conflict' | 'refused' | 'noop'

export interface MergeResult {
  status: MergeStatus
  /** Human-readable reason / summary. */
  message: string
  /** Conflicted file paths when status === 'conflict'. */
  conflicts?: string[]
}

async function git(baseDir: string, args: string[]) {
  return runCommand(['git', ...args], { cwd: baseDir, stderr: 'pipe' })
}

/**
 * Merge `branch` into the repository's currently checked-out branch.
 *
 * Refuses (without touching the repo) on: missing branch, detached HEAD,
 * self-merge, or a dirty working tree. On conflict it collects the conflicting
 * files and runs `merge --abort`, so the tree is always returned to a clean
 * state. Returns a structured result; the caller surfaces it (no silent fail).
 */
export async function mergeIssueBranch(baseDir: string, branch: string): Promise<MergeResult> {
  const exists = await git(baseDir, ['rev-parse', '--verify', '--quiet', branch])
  if (exists.code !== 0) {
    return { status: 'refused', message: `Branch "${branch}" not found` }
  }

  const cur = await git(baseDir, ['branch', '--show-current'])
  const target = cur.stdout.trim()
  if (!target) {
    return { status: 'refused', message: 'Repository is in a detached HEAD state' }
  }
  if (target === branch) {
    return { status: 'noop', message: `Already on "${branch}"` }
  }

  const dirty = await git(baseDir, ['status', '--porcelain'])
  if (dirty.stdout.trim()) {
    return { status: 'refused', message: `Working tree has uncommitted changes on "${target}"` }
  }

  const merge = await git(baseDir, ['merge', '--no-ff', '--no-edit', branch])
  if (merge.code === 0) {
    return { status: 'merged', message: `Merged "${branch}" into "${target}"` }
  }

  // Failure — most commonly a conflict. Collect conflicts, then abort so the
  // working tree is never left in a partially-merged state.
  const conflictList = await git(baseDir, ['diff', '--name-only', '--diff-filter=U'])
  const conflicts = conflictList.stdout.split('\n').map(s => s.trim()).filter(Boolean)
  await git(baseDir, ['merge', '--abort'])
  return {
    status: 'conflict',
    message: `Merge of "${branch}" into "${target}" hit conflicts`,
    conflicts,
  }
}
