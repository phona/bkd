import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileBrowserPanel } from '@/components/files/FileBrowserPanel'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import type { DockTab } from '@/stores/dock-store'
import { useDockStore } from '@/stores/dock-store'
import { DiffPanel } from './DiffPanel'
import { DockTerminal } from './DockTerminal'
import { TerminalKeyBar } from './TerminalKeyBar'

const TAB_TITLES: Record<DockTab, string> = {
  terminal: 'dock.terminal',
  files: 'dock.files',
  diff: 'dock.diff',
}

/**
 * Mobile summon overlay host (PLAN-036). The composer's ⋯ menu calls
 * dock.openMobile(tab); this renders the chosen panel full-screen. Closing
 * (× / back) hides — it does not unmount — so panels stay alive. The whole
 * host is display:none while no panel is summoned, keeping a previously
 * opened terminal's PTY alive (disposed only when the issue unmounts).
 */
export function MobileDockOverlay({
  projectId,
  issueId,
  terminalCwd,
  useWorktree,
  changesRoot,
}: {
  projectId: string
  issueId: string
  terminalCwd: string | null
  useWorktree?: boolean
  changesRoot?: string
}) {
  const { t } = useTranslation()
  const mobilePanel = useDockStore(s => s.mobilePanel)
  const closeMobile = useDockStore(s => s.closeMobile)
  const setIssueContext = useFileBrowserStore(s => s.setIssueContext)

  const visitedRef = useRef<Set<DockTab>>(new Set())
  const [, forceRender] = useState(0)
  useEffect(() => {
    if (mobilePanel && !visitedRef.current.has(mobilePanel)) {
      visitedRef.current.add(mobilePanel)
      forceRender(n => n + 1)
    }
  }, [mobilePanel])

  useEffect(() => {
    if (visitedRef.current.has('files')) {
      setIssueContext(projectId, issueId, changesRoot)
    }
  }, [projectId, issueId, changesRoot, setIssueContext, mobilePanel])

  const visited = visitedRef.current

  return (
    <div className={mobilePanel ? 'fixed inset-0 z-40 flex flex-col bg-background' : 'hidden'}>
      {visited.has('terminal') ? (
        <div className="absolute inset-0 flex flex-col bg-background" hidden={mobilePanel !== 'terminal'}>
          <OverlayHeader title={t(TAB_TITLES.terminal)} onClose={closeMobile} />
          <div className="flex-1 min-h-0">
            <DockTerminal cwd={terminalCwd} className="h-full p-1" />
          </div>
          <TerminalKeyBar />
        </div>
      ) : null}
      {visited.has('files') ? (
        <div className="absolute inset-0 flex flex-col bg-background" hidden={mobilePanel !== 'files'}>
          <OverlayHeader title={t(TAB_TITLES.files)} onClose={closeMobile} />
          <div className="flex-1 min-h-0 flex flex-col">
            <FileBrowserPanel width={0} onWidthChange={() => {}} onClose={closeMobile} fullScreen />
          </div>
        </div>
      ) : null}
      {visited.has('diff') ? (
        <div className="absolute inset-0 flex flex-col bg-background" hidden={mobilePanel !== 'diff'}>
          <OverlayHeader title={t(TAB_TITLES.diff)} onClose={closeMobile} />
          <div className="flex-1 min-h-0 flex flex-col">
            <DiffPanel
              projectId={projectId}
              issueId={issueId}
              width={0}
              onWidthChange={() => {}}
              onClose={closeMobile}
              fullScreen
              useWorktree={useWorktree}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function OverlayHeader({ title, onClose }: { title: string, onClose: () => void }) {
  return (
    <div className="flex h-[46px] shrink-0 items-center border-b border-border px-3 font-semibold">
      <span>{title}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label={title}
        className="ml-auto inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <X className="size-5" />
      </button>
    </div>
  )
}
