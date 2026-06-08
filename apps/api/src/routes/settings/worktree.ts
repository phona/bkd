import type { WorktreeSettings } from '@bkd/shared'
import { zValidator } from '@hono/zod-validator'
import * as z from 'zod'
import { WORKTREE_AUTO_CLEANUP_KEY } from '@/cron/actions/builtins/worktree-cleanup'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import { WORKTREE_BASE } from '@/engines/issue/utils/worktree'
import { createOpenAPIRouter } from '@/openapi/hono'
import {
  DEFAULT_BRANCH_TEMPLATE,
  SETUP_SCRIPT_MAX_LEN,
  validateBranchTemplate,
  WORKTREE_BRANCH_TEMPLATE_KEY,
  WORKTREE_DEFAULT_BASE_BRANCH_KEY,
  WORKTREE_DELETE_BRANCH_DEFAULT_KEY,
  WORKTREE_FETCH_STRATEGY_KEY,
  WORKTREE_INIT_SUBMODULES_KEY,
  WORKTREE_SETUP_SCRIPT_KEY,
} from './worktree-keys'

const worktree = createOpenAPIRouter()

/** Read all worktree settings, parsed + defaulted. */
async function readWorktreeSettings(): Promise<WorktreeSettings> {
  const [
    fetchStrategyRaw,
    defaultBaseBranch,
    branchTemplateRaw,
    initSubmodulesRaw,
    deleteBranchDefaultRaw,
    setupScript,
    autoCleanupRaw,
  ] = await Promise.all([
    getAppSetting(WORKTREE_FETCH_STRATEGY_KEY),
    getAppSetting(WORKTREE_DEFAULT_BASE_BRANCH_KEY),
    getAppSetting(WORKTREE_BRANCH_TEMPLATE_KEY),
    getAppSetting(WORKTREE_INIT_SUBMODULES_KEY),
    getAppSetting(WORKTREE_DELETE_BRANCH_DEFAULT_KEY),
    getAppSetting(WORKTREE_SETUP_SCRIPT_KEY),
    getAppSetting(WORKTREE_AUTO_CLEANUP_KEY),
  ])

  const fetchStrategy =
    fetchStrategyRaw === 'always' || fetchStrategyRaw === 'never' ? fetchStrategyRaw : 'auto'

  return {
    fetchStrategy,
    defaultBaseBranch: defaultBaseBranch ?? '',
    branchTemplate: branchTemplateRaw?.trim() || DEFAULT_BRANCH_TEMPLATE,
    // default ON: only an explicit 'false' disables submodule init.
    initSubmodules: initSubmodulesRaw !== 'false',
    deleteBranchDefault: deleteBranchDefaultRaw === 'true',
    setupScript: setupScript ?? '',
    autoCleanup: autoCleanupRaw === 'true',
    worktreeRoot: WORKTREE_BASE,
  }
}

// GET /api/settings/worktree
worktree.get('/worktree', async (c) => {
  return c.json({ success: true, data: await readWorktreeSettings() })
})

const patchSchema = z
  .object({
    fetchStrategy: z.enum(['auto', 'always', 'never']).optional(),
    defaultBaseBranch: z.string().max(255).optional(),
    branchTemplate: z.string().max(255).optional(),
    initSubmodules: z.boolean().optional(),
    deleteBranchDefault: z.boolean().optional(),
    setupScript: z.string().max(SETUP_SCRIPT_MAX_LEN).optional(),
  })
  .refine(obj => Object.keys(obj).length > 0, { message: 'No settings provided' })

// PATCH /api/settings/worktree
worktree.patch(
  '/worktree',
  zValidator('json', patchSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { success: false, error: result.error.issues.map(i => i.message).join(', ') },
        400,
      )
    }
  }),
  async (c) => {
    const body = c.req.valid('json')

    // Validate the branch template before persisting anything.
    if (body.branchTemplate !== undefined) {
      const err = validateBranchTemplate(body.branchTemplate)
      if (err) return c.json({ success: false, error: err }, 400 as const)
    }

    const writes: Promise<void>[] = []
    if (body.fetchStrategy !== undefined) {
      writes.push(setAppSetting(WORKTREE_FETCH_STRATEGY_KEY, body.fetchStrategy))
    }
    if (body.defaultBaseBranch !== undefined) {
      writes.push(setAppSetting(WORKTREE_DEFAULT_BASE_BRANCH_KEY, body.defaultBaseBranch.trim()))
    }
    if (body.branchTemplate !== undefined) {
      writes.push(setAppSetting(WORKTREE_BRANCH_TEMPLATE_KEY, body.branchTemplate.trim()))
    }
    if (body.initSubmodules !== undefined) {
      writes.push(setAppSetting(WORKTREE_INIT_SUBMODULES_KEY, String(body.initSubmodules)))
    }
    if (body.deleteBranchDefault !== undefined) {
      writes.push(setAppSetting(WORKTREE_DELETE_BRANCH_DEFAULT_KEY, String(body.deleteBranchDefault)))
    }
    if (body.setupScript !== undefined) {
      writes.push(setAppSetting(WORKTREE_SETUP_SCRIPT_KEY, body.setupScript))
    }
    await Promise.all(writes)

    return c.json({ success: true, data: await readWorktreeSettings() })
  },
)

export default worktree
