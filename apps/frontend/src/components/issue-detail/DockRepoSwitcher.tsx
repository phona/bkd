import { Check, ChevronDown, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { LinkedIssueProject } from '@/types/kanban'

/**
 * Multi-project repo switcher (PLAN-037) shown atop the dock rail / mobile
 * overlay when an issue spans >1 linked project. Selecting a repo retargets the
 * Terminal / Files / Diff panels to that repo's worktree. Mirrors the approved
 * prototype's "📦 bkd ▾" dropdown + "N repos" badge.
 */
export function DockRepoSwitcher({
  repos,
  selectedProjectId,
  onSelect,
}: {
  repos: LinkedIssueProject[]
  selectedProjectId: string
  onSelect: (projectId: string) => void
}) {
  const { t } = useTranslation()
  const current = repos.find(r => r.projectId === selectedProjectId) ?? repos[0]

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-accent-brand/5 px-2.5">
      <span className="text-[11px] text-muted-foreground">{t('dock.repo')}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-brand/60 bg-card px-2 py-1 text-[12.5px] font-semibold transition-colors hover:bg-accent-brand/10"
              style={{ color: 'var(--accent-brand)' }}
            />
          )}
        >
          <Package className="size-3.5 shrink-0" />
          <span className="max-w-[160px] truncate">{current?.name}</span>
          <ChevronDown className="size-3 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          {repos.map(r => (
            <DropdownMenuItem
              key={r.projectId}
              onSelect={() => onSelect(r.projectId)}
              className={r.projectId === selectedProjectId ? 'bg-accent/50' : ''}
            >
              <Package className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{r.name}</span>
              {r.isPrimary
                ? (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {t('dock.repoPrimary')}
                    </span>
                  )
                : null}
              {r.projectId === selectedProjectId
                ? <Check className="ml-auto size-3.5 shrink-0" style={{ color: 'var(--accent-brand)' }} />
                : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="ml-auto text-[11px] text-muted-foreground">
        {t('dock.repoCount', { count: repos.length })}
      </span>
    </div>
  )
}
