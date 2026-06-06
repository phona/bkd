import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { findProject, getAppSetting } from '@/db/helpers'
import { runCommand } from '@/engines/spawn'
import { zValidator } from '@hono/zod-validator'
import * as z from 'zod'
import { createOpenAPIRouter } from '@/openapi/hono'
import { ROOT_DIR } from '@/root'

const detectRemoteSchema = z.object({
  directory: z.string().min(1).max(1000),
})

const branchesQuerySchema = z.object({
  projectId: z.string().min(1).max(64),
})

async function runGit(args: string[], cwd: string): Promise<{ code: number, stdout: string }> {
  return runCommand(['git', ...args], { cwd })
}

const git = createOpenAPIRouter()

// POST /api/git/detect-remote — Detect git remote URL from a directory
git.post(
  '/detect-remote',
  zValidator('json', detectRemoteSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error.issues.map(i => i.message).join(', '),
        },
        400,
      )
    }
  }),
  async (c) => {
    const { directory } = c.req.valid('json')
    const dir = resolve(directory)

    // SEC-030: Validate directory is within workspace root
    const workspaceRoot = await getAppSetting('workspace:defaultPath')
    if (workspaceRoot && workspaceRoot !== '/') {
      const resolvedWorkspace = resolve(workspaceRoot)
      const isInside = dir === resolvedWorkspace || dir.startsWith(`${resolvedWorkspace}/`)
      if (!isInside) {
        return c.json({ success: false, error: 'Directory is outside the configured workspace' }, 403)
      }
    }

    // Check directory exists
    try {
      const s = await stat(dir)
      if (!s.isDirectory()) {
        return c.json({ success: false, error: 'not_a_directory' }, 400)
      }
    } catch {
      return c.json({ success: false, error: 'directory_not_found' }, 404)
    }

    // Check if it's a git repo
    const revParse = await runGit(['rev-parse', '--is-inside-work-tree'], dir)
    if (revParse.code !== 0 || revParse.stdout.trim() !== 'true') {
      return c.json({ success: false, error: 'not_a_git_repo' }, 400)
    }

    // Try to get remote URL — prefer 'origin', fall back to first remote
    const originUrl = await runGit(['remote', 'get-url', 'origin'], dir)
    if (originUrl.code === 0 && originUrl.stdout.trim()) {
      const url = normalizeGitUrl(originUrl.stdout.trim())
      return c.json({ success: true, data: { url, remote: 'origin' } })
    }

    // List all remotes and try the first one
    const remoteList = await runGit(['remote'], dir)
    if (remoteList.code === 0 && remoteList.stdout.trim()) {
      const firstRemote = remoteList.stdout.trim().split('\n')[0]
      if (firstRemote) {
        const remoteUrl = await runGit(['remote', 'get-url', firstRemote], dir)
        if (remoteUrl.code === 0 && remoteUrl.stdout.trim()) {
          const url = normalizeGitUrl(remoteUrl.stdout.trim())
          return c.json({
            success: true,
            data: { url, remote: firstRemote },
          })
        }
      }
    }

    return c.json({ success: false, error: 'no_remote_found' }, 404)
  },
)

// GET /api/git/branches?projectId=… — List branches in a project's repo.
// Used by the create-issue worktree options (WT-001) to pick a base branch.
git.get(
  '/branches',
  zValidator('query', branchesQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: 'Invalid projectId' }, 400)
    }
  }),
  async (c) => {
    const { projectId } = c.req.valid('query')
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404)
    }

    const dir = project.directory ? resolve(project.directory) : ROOT_DIR

    const rev = await runGit(['rev-parse', '--is-inside-work-tree'], dir)
    if (rev.code !== 0 || rev.stdout.trim() !== 'true') {
      return c.json({ success: true, data: { branches: [], current: null } })
    }

    const refs = await runGit(
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
      dir,
    )
    const branches = Array.from(
      new Set(
        refs.stdout
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !l.endsWith('/HEAD')),
      ),
    ).sort()

    const cur = await runGit(['branch', '--show-current'], dir)
    const current = cur.stdout.trim() || null

    return c.json({ success: true, data: { branches, current } })
  },
)

/** Convert SSH git URLs to HTTPS format for browser use */
function normalizeGitUrl(url: string): string {
  // git@github.com:org/repo.git → https://github.com/org/repo
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`
  }
  // Remove trailing .git from HTTPS URLs
  return url.replace(/\.git$/, '')
}

export default git
