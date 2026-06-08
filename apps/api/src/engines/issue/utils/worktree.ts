import { mkdir, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueProjects as issueProjectsTable, projects as projectsTable } from '@/db/schema'
import { WORKTREE_DIR } from '@/engines/issue/constants'
import { runCommand } from '@/engines/spawn'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'
import { isGitRepoFresh } from '@/utils/git'

/** Resolve WORKTREE_DIR — absolute paths used as-is, relative resolved from ROOT_DIR */
export const WORKTREE_BASE = WORKTREE_DIR.startsWith('/') ?
  WORKTREE_DIR :
    join(ROOT_DIR, WORKTREE_DIR)

/** Safe root for rm fallback — never delete outside this directory */
const WORKTREE_SAFE_ROOT = WORKTREE_BASE

// ---------- Git worktree helpers ----------

/**
 * Deterministic worktree path: `<WORKTREE_BASE>/<projectId>/<issueId>/`
 */
export function resolveWorktreePath(projectId: string, issueId: string): string {
  return join(WORKTREE_BASE, projectId, issueId)
}

/** Return the ref name if it resolves to a commit in `baseDir`, else null. */
async function verifyRef(baseDir: string, ref: string): Promise<string | null> {
  const { code } = await runCommand(
    ['git', 'rev-parse', '--verify', '--quiet', ref],
    { cwd: baseDir, stderr: 'pipe' },
  )
  return code === 0 ? ref : null
}

/**
 * Resolve the start-point ref for worktree creation.
 *
 * Priority:
 *  1. The repo's actual default branch via `origin/HEAD` (handles repos
 *     using `release`/`develop`/etc. instead of `main`/`master`).
 *  2. Common default-branch names.
 *  3. Current `HEAD` as a last resort — a worktree branched off HEAD is
 *     still isolated from the main checkout, which is far safer than
 *     falling back to running directly in the shared repo directory.
 *
 * Throws only when even `HEAD` cannot be resolved (e.g. an empty repo).
 */
async function resolveStartPoint(baseDir: string): Promise<string> {
  // 1. Repo's declared default branch (origin/HEAD -> refs/remotes/origin/<x>).
  const { code, stdout } = await runCommand(
    ['git', 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
    { cwd: baseDir, stderr: 'pipe' },
  )
  if (code === 0) {
    const defaultRef = stdout.trim().replace(/^refs\/remotes\//, '')
    if (defaultRef && (await verifyRef(baseDir, defaultRef))) return defaultRef
  }

  // 2. Common default-branch names.
  const candidates = [
    'origin/main',
    'origin/master',
    'origin/release',
    'origin/develop',
    'main',
    'master',
    'release',
    'develop',
  ]
  for (const ref of candidates) {
    if (await verifyRef(baseDir, ref)) return ref
  }

  // 3. Last resort — current HEAD (still isolated as a separate worktree).
  if (await verifyRef(baseDir, 'HEAD')) {
    logger.warn({ baseDir }, 'worktree_start_point_fallback_head')
    return 'HEAD'
  }

  throw new Error(`Cannot resolve a worktree start point in ${baseDir}`)
}

export interface CreateWorktreeOptions {
  /**
   * Optional git ref to branch the worktree from. Defaults to the resolved
   * default-branch start point. Used by forked dependent issues to start
   * from the parent issue's branch (PLAN-021).
   */
  startPointRef?: string
  /**
   * Optional branch name for the new worktree. Defaults to `bkd/{issueId}`.
   * Used by WT-001 to let users name the branch.
   */
  branchNameOverride?: string
  /**
   * Attach the worktree to an existing branch instead of creating a new one
   * (mirrors AoE's "Attach to existing branch" toggle). When true, the
   * branch named by `branchNameOverride` is checked out as-is and the start
   * point is ignored — git rejects a worktree that does not name a real
   * branch, which is the intended guard.
   */
  attachExisting?: boolean
}

/**
 * Build a readable, unique, git-safe branch name from an issue title + id:
 *   "Fix login bug" + iioianio → bkd/fix-login-bug-iioianio
 *   "修复登录态"     + iioianio → bkd/iioianio   (no ascii slug → id only)
 * The id suffix guarantees uniqueness (no collisions between similar titles);
 * the ascii-only slug + id fallback keep it checkout-safe for CJK/emoji titles.
 * Called from issue creation where BOTH the title and the real id are known.
 */
export function deriveWorktreeBranch(title: string, id: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug ? `bkd/${slug}-${id}` : `bkd/${id}`
}

/**
 * Best-effort `git fetch` so a new worktree branches off the LATEST origin
 * rather than a stale local remote-tracking snapshot. Non-fatal: skips when
 * there is no remote, and fails fast (never prompts) when offline / auth is
 * required — in those cases we just fall back to the local refs.
 */
async function tryFetch(baseDir: string): Promise<void> {
  const remotes = await runCommand(['git', 'remote'], { cwd: baseDir, stderr: 'pipe' })
  if (remotes.code !== 0 || !remotes.stdout.trim()) return
  const res = await runCommand(['git', 'fetch', '--quiet', '--prune'], {
    cwd: baseDir,
    stderr: 'pipe',
    timeout: 15000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (res.code !== 0) {
    logger.warn({ baseDir, err: res.stderr.trim().slice(0, 200) }, 'worktree_fetch_skipped')
  }
}

export async function createWorktree(
  baseDir: string,
  projectId: string,
  issueId: string,
  /**
   * Backwards-compatible: either the legacy `startPointRef` string or an
   * options object. Existing callers (fork/dependent) pass the ref string.
   */
  startPointRefOrOptions?: string | CreateWorktreeOptions,
  /** Legacy positional branch-name override (kept for existing call sites). */
  branchNameOverrideArg?: string,
): Promise<string> {
  const opts: CreateWorktreeOptions = typeof startPointRefOrOptions === 'string' || startPointRefOrOptions == null ?
      { startPointRef: startPointRefOrOptions as string | undefined, branchNameOverride: branchNameOverrideArg } :
    startPointRefOrOptions

  // Guard: baseDir must be inside a git work tree
  if (!(await isGitRepoFresh(baseDir))) {
    throw new Error(`Cannot create worktree: ${baseDir} is not a git repository`)
  }

  const branchName = opts.branchNameOverride?.trim() || `bkd/${issueId}`
  const worktreeDir = resolveWorktreePath(projectId, issueId)
  await mkdir(join(WORKTREE_BASE, projectId), { recursive: true })

  // If the worktree dir already exists and is registered, reuse it as-is —
  // makes createWorktree idempotent (a forked issue may pre-create it).
  if (await isWorktreeRegistered(baseDir, worktreeDir)) {
    logger.debug({ issueId, worktreeDir }, 'worktree_reuse_existing')
    return worktreeDir
  }

  // Refresh remote-tracking refs so we branch off the latest origin (the
  // base-branch resolution + attach-existing both rely on up-to-date refs).
  await tryFetch(baseDir)

  // Attach-to-existing-branch path: check out the named branch without
  // creating a new one. The branch must already exist (local or remote).
  if (opts.attachExisting) {
    const result = await runCommand(
      ['git', 'worktree', 'add', worktreeDir, branchName],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (result.code !== 0) {
      throw new Error(`Failed to attach worktree to branch "${branchName}": ${result.stderr.trim()}`)
    }
    logger.debug({ issueId, worktreeDir, branchName }, 'worktree_attached_existing')
    return worktreeDir
  }

  let startPoint = opts.startPointRef
  if (startPoint) {
    const { code } = await runCommand(
      ['git', 'rev-parse', '--verify', '--quiet', startPoint],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (code !== 0) startPoint = undefined
  }
  if (!startPoint) startPoint = await resolveStartPoint(baseDir)

  // Create worktree with a new branch off the resolved start point
  const result = await runCommand(
    ['git', 'worktree', 'add', '-b', branchName, worktreeDir, startPoint],
    { cwd: baseDir, stderr: 'pipe' },
  )
  if (result.code !== 0) {
    // Branch may already exist from a previous run — try without -b
    const retry = await runCommand(
      ['git', 'worktree', 'add', worktreeDir, branchName],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (retry.code !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr.trim()} / ${retry.stderr.trim()}`)
    }
  }
  logger.debug({ issueId, worktreeDir, branchName, startPoint }, 'worktree_created')
  return worktreeDir
}

/**
 * Delete a local git branch. Idempotent — a missing branch is treated as
 * success since the caller asked for it to be gone. Uses `-D` (force) when
 * `force` is set or the branch is not fully merged. Mirrors AoE's
 * `delete_branch` semantics.
 */
export async function deleteBranch(baseDir: string, branch: string, force = false): Promise<void> {
  const flag = force ? '-D' : '-d'
  const { code, stderr } = await runCommand(
    ['git', 'branch', flag, branch],
    { cwd: baseDir, stderr: 'pipe' },
  )
  if (code === 0) {
    logger.debug({ baseDir, branch, force }, 'worktree_branch_deleted')
    return
  }
  const err = stderr.trim()
  // Branch already gone — the desired end state is satisfied.
  if (/not found|no branch named/i.test(err)) {
    return
  }
  // Not fully merged and force wasn't requested — retry with -D.
  if (!force && /not fully merged/i.test(err)) {
    const retry = await runCommand(
      ['git', 'branch', '-D', branch],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (retry.code === 0) return
    throw new Error(`Failed to delete branch "${branch}": ${retry.stderr.trim()}`)
  }
  throw new Error(`Failed to delete branch "${branch}": ${err}`)
}

export async function removeWorktree(
  baseDir: string,
  worktreeDir: string,
  /**
   * When true, pass `--force` so git removes the worktree even if it has
   * uncommitted/untracked changes (AoE's "Force delete"). Defaults to true
   * to preserve the historical behaviour of all existing callers.
   */
  force = true,
): Promise<void> {
  const resolved = resolve(worktreeDir)
  try {
    const args = force ?
        ['git', 'worktree', 'remove', '--force', resolved] :
        ['git', 'worktree', 'remove', resolved]
    const { code, stderr } = await runCommand(
      args,
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (code !== 0) {
      throw new Error(`git worktree remove exited with code ${code}: ${stderr.trim()}`)
    }
    logger.debug({ worktreeDir: resolved }, 'worktree_removed')
  } catch (error) {
    logger.warn({ worktreeDir: resolved, error }, 'worktree_remove_failed')
    // Non-force deletes must respect uncommitted changes: git refused for a
    // reason (dirty worktree), so surface it instead of nuking the directory.
    if (!force) {
      throw error instanceof Error ? error : new Error(String(error))
    }
    // Containment guard: never rm outside the managed worktree directory
    if (!resolved.startsWith(WORKTREE_SAFE_ROOT + sep)) {
      logger.error(
        { worktreeDir: resolved, safeRoot: WORKTREE_SAFE_ROOT },
        'worktree_remove_path_escape_rejected',
      )
      return
    }
    // Fallback: just delete the directory
    try {
      await rm(resolved, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

/**
 * Non-destructive dirty check for a worktree directory. Returns `true` when the
 * worktree has uncommitted/untracked changes (`git status --porcelain` non-empty).
 * A missing directory, a non-directory, or a non-git path is treated as NOT
 * dirty (nothing to lose). Used to pre-check ALL of an issue's repos before a
 * multi-repo clean so we never partially remove.
 */
export async function isWorktreeDirty(worktreeDir: string): Promise<boolean> {
  const resolved = resolve(worktreeDir)
  try {
    const s = await stat(resolved)
    if (!s.isDirectory()) return false
  } catch {
    return false
  }
  const { code, stdout } = await runCommand(
    ['git', 'status', '--porcelain'],
    { cwd: resolved, stderr: 'pipe' },
  )
  if (code !== 0) return false
  return stdout.trim().length > 0
}

/**
 * Verify that a worktree directory is registered under the given git repo.
 * Returns `true` if `git worktree list` from `baseDir` includes `worktreeDir`.
 */
export async function isWorktreeRegistered(baseDir: string, worktreeDir: string): Promise<boolean> {
  try {
    const { code, stdout: output } = await runCommand(
      ['git', 'worktree', 'list', '--porcelain'],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (code !== 0) return false
    // Each worktree block starts with "worktree <absolute-path>"
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ') && line.slice(9) === worktreeDir) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/** A bkd project linked to an issue (PLAN-037), excluding the primary. */
export interface LinkedProjectRow {
  id: string
  name: string
  directory: string | null
}

/**
 * Load the non-primary linked projects for an issue (PLAN-037). Returns only
 * projects that still exist (not soft-deleted) and have a directory on disk.
 */
export async function getLinkedProjects(issueId: string): Promise<LinkedProjectRow[]> {
  const rows = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      directory: projectsTable.directory,
    })
    .from(issueProjectsTable)
    .innerJoin(projectsTable, eq(issueProjectsTable.projectId, projectsTable.id))
    .where(
      and(
        eq(issueProjectsTable.issueId, issueId),
        eq(issueProjectsTable.isPrimary, false),
        eq(issueProjectsTable.isDeleted, 0),
        eq(projectsTable.isDeleted, 0),
      ),
    )
  return rows
}

/** A successfully materialized linked worktree. */
export interface LinkedWorktree {
  projectId: string
  projectName: string
  path: string
}

/**
 * Materialize worktrees for an issue's linked projects (PLAN-037) on the SAME
 * branch as the primary worktree. Each linked repo uses its OWN default base +
 * fetch (handled inside `createWorktree`). Partial-failure tolerant: a failing
 * repo is reported via `onError` and skipped; it never aborts the others.
 *
 * @param issueId - The issue whose linked projects to materialize.
 * @param branchName - The issue's resolved branch name (same in every repo).
 * @param onError - Called for each linked repo that fails, so the caller can
 *   surface a chat-visible note. The materialization itself never throws.
 */
export async function materializeLinkedWorktrees(
  issueId: string,
  branchName: string,
  onError?: (projectName: string, reason: string) => void,
): Promise<LinkedWorktree[]> {
  const linked = await getLinkedProjects(issueId)
  const results: LinkedWorktree[] = []
  for (const project of linked) {
    if (!project.directory) {
      onError?.(project.name, 'project has no directory configured')
      continue
    }
    try {
      const path = await createWorktree(project.directory, project.id, issueId, {
        branchNameOverride: branchName,
      })
      results.push({ projectId: project.id, projectName: project.name, path })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.warn({ issueId, linkedProjectId: project.id, err: error }, 'linked_worktree_creation_failed')
      onError?.(project.name, reason)
    }
  }
  return results
}

/**
 * Build the prompt suffix that tells the agent where the linked repos are
 * checked out (same branch). Empty string when there are none.
 */
export function buildLinkedReposPromptSuffix(linked: LinkedWorktree[]): string {
  if (linked.length === 0) return ''
  const list = linked.map(w => `${w.path} (${w.projectName})`).join(', ')
  return (
    '\n\n[BKD] Additional linked repos are checked out on this same branch at: '
    + `${list} — cd into them as needed.`
  )
}

/**
 * Fire-and-forget worktree cleanup.
 * @param baseDir - The git repo directory that owns this worktree
 */
export function cleanupWorktree(baseDir: string, issueId: string, worktreePath: string): void {
  void removeWorktree(baseDir, worktreePath).catch((error) => {
    logger.warn({ issueId, worktreePath, error }, 'worktree_cleanup_failed')
  })
}
