import { useMemo, useState } from 'react'
import { useIssueLinkedProjects } from '@/hooks/use-kanban'
import type { LinkedIssueProject } from '@/types/kanban'

/**
 * Multi-project association (PLAN-037): resolves which repo the dock panels
 * (Terminal / Files / Diff) currently target.
 *
 * With a single (or zero) linked project the behaviour is IDENTICAL to before:
 * no switcher is shown, the selected project is the primary, and the resolved
 * cwd is the caller-provided `terminalCwd` (primary worktree path, or undefined
 * while loading). Only when there are 2+ linked projects does a switcher appear
 * and selecting a non-primary repo retarget the panels to that repo's worktree.
 */
export interface DockRepoState {
  /** All linked projects (primary first), or empty while loading / none. */
  repos: LinkedIssueProject[]
  /** True when there is more than one linked project → show the switcher. */
  hasMultiple: boolean
  /** The currently selected project's id. */
  selectedProjectId: string
  /** The currently selected repo (or undefined). */
  selected: LinkedIssueProject | undefined
  /** Whether the selected repo is the primary one. */
  isPrimary: boolean
  /** Switch the active repo. */
  setSelectedProjectId: (id: string) => void
  /**
   * The cwd to drive Terminal / Files with. For the primary repo this falls
   * back to the caller's `terminalCwd` so single-repo behaviour is unchanged.
   * `undefined` while the primary worktree path is still loading.
   */
  resolvedCwd: string | null | undefined
}

export function useDockRepo(
  projectId: string,
  issueId: string,
  /** Primary worktree cwd (undefined while loading, null if none). */
  terminalCwd: string | null | undefined,
): DockRepoState {
  const { data } = useIssueLinkedProjects(projectId, issueId)
  const repos = useMemo(() => data ?? [], [data])
  const hasMultiple = repos.length > 1

  const primaryId = useMemo(
    () => repos.find(r => r.isPrimary)?.projectId ?? projectId,
    [repos, projectId],
  )
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')

  // Default to (and clamp to) a valid selection: the primary repo.
  const effectiveSelectedId
    = selectedProjectId && repos.some(r => r.projectId === selectedProjectId)
      ? selectedProjectId
      : primaryId

  const selected = repos.find(r => r.projectId === effectiveSelectedId)
  const isPrimary = effectiveSelectedId === primaryId

  // Primary → keep the caller's terminalCwd (undefined while loading) so the
  // single-repo contract is preserved. Non-primary → that repo's worktree path
  // (null when it isn't on disk yet).
  const resolvedCwd = isPrimary ? terminalCwd : (selected?.worktreePath ?? null)

  return {
    repos,
    hasMultiple,
    selectedProjectId: effectiveSelectedId,
    selected,
    isPrimary,
    setSelectedProjectId,
    resolvedCwd,
  }
}
