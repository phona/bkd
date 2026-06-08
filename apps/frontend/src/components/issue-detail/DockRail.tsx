import { ChevronsLeft, ChevronsRight, FileDiff, FolderOpen, SquareTerminal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileBrowserPanel } from '@/components/files/FileBrowserPanel'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import type { DockTab } from '@/stores/dock-store'
import { useDockStore } from '@/stores/dock-store'
import { DiffPanel } from './DiffPanel'
import { DockTerminal } from './DockTerminal'

const TABS: Array<{ id: DockTab, icon: typeof SquareTerminal, labelKey: string }> = [
  { id: 'terminal', icon: SquareTerminal, labelKey: 'dock.terminal' },
  { id: 'files', icon: FolderOpen, labelKey: 'dock.files' },
  { id: 'diff', icon: FileDiff, labelKey: 'dock.diff' },
]

const noop = () => {}

/**
 * Desktop persistent right rail (PLAN-036). Hosts Terminal / Files / Diff as
 * tabs. Resizable (drag left edge), collapsible to an icon strip. Visited tabs
 * are kept mounted and hidden via CSS so their state (PTY, browse path, diff)
 * survives tab switches — see DockTerminal for the PTY keep-alive ↔ disposal.
 *
 * Rendered whenever an issue is open on desktop; when the rail is "closed"
 * (dock.open === false) the host stays mounted but display:none, so a
 * previously-opened terminal is not killed just by toggling the rail shut.
 */
export function DockRail({
  projectId,
  issueId,
  terminalCwd,
  useWorktree,
  changesRoot,
}: {
  projectId: string
  issueId: string
  terminalCwd: string | null | undefined
  useWorktree?: boolean
  changesRoot?: string
}) {
  const { t } = useTranslation()
  const open = useDockStore(s => s.open)
  const collapsed = useDockStore(s => s.collapsed)
  const width = useDockStore(s => s.width)
  const tab = useDockStore(s => s.tab)
  const setWidth = useDockStore(s => s.setWidth)
  const setCollapsed = useDockStore(s => s.setCollapsed)
  const openTab = useDockStore(s => s.openTab)
  const setOpen = useDockStore(s => s.setOpen)
  const setIssueContext = useFileBrowserStore(s => s.setIssueContext)

  // Track which tabs have been visited so each panel mounts lazily on first
  // open and is then kept alive (mounted, hidden) for the rest of the session.
  const visitedRef = useRef<Set<DockTab>>(new Set())
  const [, forceRender] = useState(0)
  useEffect(() => {
    if (open && !collapsed && !visitedRef.current.has(tab)) {
      visitedRef.current.add(tab)
      forceRender(n => n + 1)
    }
  }, [open, collapsed, tab])

  // Point the file browser at this issue's WORKTREE root (terminalCwd) — the
  // same dir the terminal opens in. Falls back to changesRoot. Skip while the
  // worktree path is still loading (terminalCwd === undefined) so we don't latch
  // onto the project dir first.
  useEffect(() => {
    if (terminalCwd === undefined) return
    if (visitedRef.current.has('files')) {
      setIssueContext(projectId, issueId, terminalCwd ?? changesRoot)
    }
  }, [projectId, issueId, terminalCwd, changesRoot, setIssueContext, tab, open])

  const dragRef = useRef<{ active: boolean }>({ active: false })
  const onGripDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current.active = true
  }, [])
  const onGripMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return
    setWidth(window.innerWidth - e.clientX)
  }, [setWidth])
  const onGripUp = useCallback(() => {
    dragRef.current.active = false
  }, [])

  const visited = visitedRef.current

  return (
    <div
      className={open ? 'relative flex shrink-0 border-l border-border bg-card' : 'hidden'}
      style={open ? { width: collapsed ? 48 : width } : undefined}
    >
      {open && !collapsed ? (
        <div
          className="absolute left-0 top-0 bottom-0 z-10 w-2 -translate-x-1/2 cursor-col-resize select-none group"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full bg-accent-brand/40 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity" />
        </div>
      ) : null}

      {/* Expanded rail: header tabs + keep-alive bodies */}
      <div className={collapsed ? 'hidden' : 'flex flex-1 flex-col min-w-0'}>
        <div className="flex h-[42px] shrink-0 items-center gap-1 border-b border-border px-2">
          {TABS.map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              onClick={() => openTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors ${
                tab === id
                  ? 'bg-accent-brand/10 text-accent-brand font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <Icon className="size-3.5" />
              {t(labelKey)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title={t('dock.collapse')}
            aria-label={t('dock.collapse')}
            className="ml-auto inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ChevronsRight className="size-4" />
          </button>
        </div>
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {visited.has('terminal') ? (
            <div className="absolute inset-0 flex flex-col" hidden={tab !== 'terminal'}>
              <DockTerminal cwd={terminalCwd} className="flex-1 min-h-0 p-1" />
            </div>
          ) : null}
          {visited.has('files') ? (
            <div className="absolute inset-0 flex flex-col" hidden={tab !== 'files'}>
              <FileBrowserPanel width={0} onWidthChange={noop} onClose={() => setOpen(false)} fullScreen />
            </div>
          ) : null}
          {visited.has('diff') ? (
            <div className="absolute inset-0 flex flex-col" hidden={tab !== 'diff'}>
              <DiffPanel
                projectId={projectId}
                issueId={issueId}
                width={0}
                onWidthChange={noop}
                onClose={() => setOpen(false)}
                fullScreen
                useWorktree={useWorktree}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Collapsed strip: expand + per-tab icons */}
      {collapsed ? (
        <div className="flex w-full flex-col items-center gap-2 pt-2.5">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title={t('dock.expand')}
            aria-label={t('dock.expand')}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronsLeft className="size-4" />
          </button>
          {TABS.map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              onClick={() => openTab(id)}
              title={t(labelKey)}
              aria-label={t(labelKey)}
              className={`inline-flex size-8 items-center justify-center rounded-lg border transition-colors ${
                tab === id
                  ? 'border-accent-brand bg-accent-brand/10 text-accent-brand'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
