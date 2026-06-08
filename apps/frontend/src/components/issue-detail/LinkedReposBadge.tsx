import { Boxes } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIssueLinkedProjects } from '@/hooks/use-kanban'

/**
 * Multi-project association (PLAN-037) surfacing badge: shows "N repos" when an
 * issue spans more than one linked project. Rendered on the Kanban card and the
 * issue-detail bar (mobile-visible). The query is gated on `enabled` (only
 * worktree issues can have links) to avoid fetching for every card.
 */
export function LinkedReposBadge({
  projectId,
  issueId,
  enabled = true,
  className,
}: {
  projectId: string
  issueId: string
  enabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const { data } = useIssueLinkedProjects(projectId, issueId, enabled)
  const count = data?.length ?? 0
  if (count <= 1) return null

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 font-medium ${className ?? ''}`}
      style={{ color: 'var(--accent-brand)' }}
      title={t('issue.linkedRepos', { count })}
    >
      <Boxes className="size-2.5 shrink-0" aria-hidden />
      {t('issue.linkedRepos', { count })}
    </span>
  )
}
