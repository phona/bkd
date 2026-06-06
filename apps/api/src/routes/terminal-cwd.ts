import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { db } from '@/db'
import { projects } from '@/db/schema'
import { WORKTREE_BASE } from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'

/** True when `child` is `parent` or lives inside it (path-segment aware). */
function isInside(child: string, parent: string): boolean {
  const c = resolve(child)
  const p = resolve(parent)
  if (c === p) return true
  return c.startsWith(p.endsWith(sep) ? p : p + sep)
}

function realpathOrResolve(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/**
 * Directories a terminal is allowed to start in: the app root, the worktree
 * base, and every configured project directory. Anything outside these is
 * rejected so a client cannot point a shell at an arbitrary path.
 */
export function listAllowedTerminalRoots(): string[] {
  const roots = [ROOT_DIR, WORKTREE_BASE]
  try {
    const rows = db.select({ dir: projects.directory }).from(projects).all()
    for (const row of rows) {
      if (row.dir) roots.push(row.dir)
    }
  } catch (err) {
    logger.warn({ err }, 'terminal_cwd_project_roots_unavailable')
  }
  return roots
}

/**
 * Validate a requested terminal working directory against the allowlist.
 *
 * Returns the canonical (realpath) directory when allowed, or `null` when the
 * request is empty (caller should fall back to HOME) or invalid (caller should
 * reject). Uses realpath on both sides so `..` traversal and symlinks cannot
 * escape an allowed root.
 */
export function resolveTerminalCwd(requested: string | null | undefined): string | null {
  if (!requested || !requested.trim()) return null

  let real: string
  try {
    real = realpathSync(requested)
  } catch {
    // Non-existent path — reject.
    return null
  }

  for (const root of listAllowedTerminalRoots()) {
    if (isInside(real, realpathOrResolve(root))) return real
  }
  return null
}
