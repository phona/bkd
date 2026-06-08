import { getAppSetting } from '@/db/helpers'

// ─────────────────────────────────────────────────────────────
// Worktree setting keys (PLAN-039). All values are string KV in
// `appSettings`; no schema/migration. Shared between the settings
// route (read/write) and the worktree engine utils (read at call time).
// ─────────────────────────────────────────────────────────────

export const WORKTREE_FETCH_STRATEGY_KEY = 'worktree:fetchStrategy'
export const WORKTREE_DEFAULT_BASE_BRANCH_KEY = 'worktree:defaultBaseBranch'
export const WORKTREE_BRANCH_TEMPLATE_KEY = 'worktree:branchTemplate'
export const WORKTREE_INIT_SUBMODULES_KEY = 'worktree:initSubmodules'
export const WORKTREE_DELETE_BRANCH_DEFAULT_KEY = 'worktree:deleteBranchDefault'
export const WORKTREE_SETUP_SCRIPT_KEY = 'worktree:setupScript'

export const DEFAULT_BRANCH_TEMPLATE = 'bkd/{slug}-{id}'
export const SETUP_SCRIPT_MAX_LEN = 4000

export type FetchStrategy = 'auto' | 'always' | 'never'

/** Read + validate the fetch strategy setting, defaulting to `auto`. */
export async function resolveFetchStrategy(): Promise<FetchStrategy> {
  const raw = (await getAppSetting(WORKTREE_FETCH_STRATEGY_KEY))?.trim()
  return raw === 'always' || raw === 'never' ? raw : 'auto'
}

/**
 * Validate a branch-name template: after substituting the known vars it must be
 * non-empty, must include `{id}` (uniqueness), and must use only git-safe chars.
 * Returns an error message string when invalid, or null when valid.
 */
export function validateBranchTemplate(template: string): string | null {
  const t = template.trim()
  if (!t) return 'Branch template must not be empty'
  if (!t.includes('{id}')) return 'Branch template must include {id} for uniqueness'
  // Substitute vars with representative safe sample values, then check the
  // remaining literal characters are git-ref-safe.
  const sample = t
    .replace(/\{slug\}/g, 'sample-slug')
    .replace(/\{id\}/g, 'abcd1234')
    .replace(/\{repo\}/g, 'sample-repo')
  // Reject whitespace and git-unsafe ref characters.
  // git check-ref-format disallows: space, ~ ^ : ? * [ \ and control chars,
  // and ".." sequences / trailing ".lock" / leading-trailing slash.
  if (/[\s~^:?*[\\]/.test(sample)) {
    return 'Branch template contains characters that are not allowed in a git branch name'
  }
  if (sample.includes('..') || sample.startsWith('/') || sample.endsWith('/') || sample.endsWith('.lock')) {
    return 'Branch template produces an invalid git branch name'
  }
  return null
}
