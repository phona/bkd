import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { mergeIssueBranch } from '@/engines/issue/utils/merge'
import { runCommand } from '@/engines/spawn'

async function git(cwd: string, args: string[]) {
  const r = await runCommand(['git', ...args], { cwd, stderr: 'pipe' })
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r
}

const dirs: string[] = []

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bkd-merge-'))
  dirs.push(dir)
  await git(dir, ['init', '-b', 'main'])
  await git(dir, ['config', 'user.email', 'test@bkd.local'])
  await git(dir, ['config', 'user.name', 'bkd test'])
  await writeFile(join(dir, 'a.txt'), 'line1\nline2\n')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-m', 'init'])
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
})

describe('mergeIssueBranch (WT-003)', () => {
  it('merges a non-conflicting branch into the current branch', async () => {
    const dir = await initRepo()
    await git(dir, ['checkout', '-b', 'feat'])
    await writeFile(join(dir, 'b.txt'), 'new file\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'add b'])
    await git(dir, ['checkout', 'main'])

    const res = await mergeIssueBranch(dir, 'feat')
    expect(res.status).toBe('merged')
    // b.txt now present on main
    const ls = await git(dir, ['ls-files'])
    expect(ls.stdout).toContain('b.txt')
  })

  it('reports conflicts and leaves a clean tree (aborts)', async () => {
    const dir = await initRepo()
    await git(dir, ['checkout', '-b', 'feat'])
    await writeFile(join(dir, 'a.txt'), 'line1\nFEAT\n')
    await git(dir, ['commit', '-am', 'feat edit'])
    await git(dir, ['checkout', 'main'])
    await writeFile(join(dir, 'a.txt'), 'line1\nMAIN\n')
    await git(dir, ['commit', '-am', 'main edit'])

    const res = await mergeIssueBranch(dir, 'feat')
    expect(res.status).toBe('conflict')
    expect(res.conflicts).toContain('a.txt')
    // tree clean again after abort
    const status = await git(dir, ['status', '--porcelain'])
    expect(status.stdout.trim()).toBe('')
  })

  it('refuses when the branch does not exist', async () => {
    const dir = await initRepo()
    const res = await mergeIssueBranch(dir, 'nope')
    expect(res.status).toBe('refused')
  })

  it('refuses when the working tree is dirty', async () => {
    const dir = await initRepo()
    await git(dir, ['checkout', '-b', 'feat'])
    await writeFile(join(dir, 'b.txt'), 'x\n')
    await git(dir, ['add', '.'])
    await git(dir, ['commit', '-m', 'add b'])
    await git(dir, ['checkout', 'main'])
    await writeFile(join(dir, 'a.txt'), 'dirty\n') // uncommitted change

    const res = await mergeIssueBranch(dir, 'feat')
    expect(res.status).toBe('refused')
  })
})
