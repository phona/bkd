import { CircleDot, CircleSlash } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Issue } from '@/types/kanban'

/**
 * Worktree lifecycle (PLAN-038) surfacing badge: shows the issue's
 * `worktreeState` wherever a worktree-using issue appears (kanban card +
 * issue-detail bar, both mobile-visible).
 *
 * - `active`  → teal "● worktree"
 * - `cleaned` → gray "○ worktree 已清理"
 * - `none` / `useWorktree=false` → renders nothing.
 *
 * `shrink-0` + `truncate` keep it from overflowing the narrow mobile card.
 */
export function WorktreeStateBadge({
  issue,
  className,
}: {
  issue: Pick<Issue, 'useWorktree' | 'worktreeState'>
  className?: string
}) {
  const { t } = useTranslation()
  if (!issue.useWorktree) return null
  const state = issue.worktreeState ?? 'none'
  if (state === 'none') return null

  if (state === 'cleaned') {
    return (
      <span
        className={`inline-flex shrink-0 items-center gap-0.5 font-medium text-muted-foreground/70 ${className ?? ''}`}
        title={t('worktree.state.cleanedTitle')}
      >
        <CircleSlash className="size-2.5 shrink-0" aria-hidden />
        <span className="truncate">{t('worktree.state.cleaned')}</span>
      </span>
    )
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 font-medium ${className ?? ''}`}
      style={{ color: 'var(--accent-brand)' }}
      title={t('worktree.state.activeTitle')}
    >
      <CircleDot className="size-2.5 shrink-0" aria-hidden />
      <span className="truncate">{t('worktree.state.active')}</span>
    </span>
  )
}
