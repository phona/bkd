import { Minus, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  closeTerminalTab,
  createTerminalTab,
  disposeTerminal,
  nudgeTerminalFont,
  setBackToLiveLabel,
  setPendingInitialCwd,
  switchTerminalTab,
  TerminalView,
} from '@/components/terminal/TerminalView'
import { MAX_TERMINAL_TABS, useTerminalSessionStore } from '@/stores/terminal-session-store'

/**
 * Terminal host for the issue-detail dock (PLAN-036).
 *
 * Lifecycle contract (BUG-004):
 *  - PTYs are spawned only once this component mounts. Parents keep it mounted
 *    afterwards and hide it via CSS — sessions survive tab switches and rail
 *    open/close (keep-alive).
 *  - On unmount (issue change / navigate away / mobile↔desktop flip) ALL of the
 *    issue's terminal sessions are disposed. Hidden ≠ leaked, but the sessions
 *    are always torn down when the host genuinely goes away.
 *
 * The cwd is applied BEFORE the inner <TerminalView> mounts (gated behind
 * `ready`) so the very first connection starts in the issue's worktree dir.
 * Multiple parallel sessions (up to MAX_TERMINAL_TABS) share that cwd; switching
 * between them is instant (no reconnect).
 */
export function DockTerminal({ cwd, className }: { cwd?: string | null, className?: string }) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const armedRef = useRef(false)
  const order = useTerminalSessionStore(s => s.order)
  const activeId = useTerminalSessionStore(s => s.activeId)

  // Keep the "Back to live" pill label in sync with the active language.
  useEffect(() => {
    setBackToLiveLabel(t('dock.backToLive'))
  }, [t])

  // Arm the cwd ONCE, but only after it has resolved (`undefined` = the worktree
  // list is still loading). This guarantees the first PTY connection starts in
  // the issue's worktree dir instead of the default/project cwd.
  useEffect(() => {
    if (armedRef.current || cwd === undefined) return
    armedRef.current = true
    setPendingInitialCwd(cwd ?? null)
    setReady(true)
  }, [cwd])

  // Dispose ALL of the issue's PTYs when the host genuinely unmounts.
  useEffect(() => () => disposeTerminal(), [])

  if (!ready) return null

  const canAdd = order.length < MAX_TERMINAL_TABS

  return (
    <div className="flex h-full min-h-0 flex-col">
      {order.length > 1 || canAdd ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/40 px-1.5 py-1">
          {order.map((id, i) => (
            <div
              key={id}
              className={`group inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] transition-colors ${
                id === activeId
                  ? 'border-accent-brand bg-accent-brand/10 text-accent-brand'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              <button type="button" onClick={() => switchTerminalTab(id)} className="font-mono">
                {t('dock.terminalTab', { n: i + 1 })}
              </button>
              {order.length > 1 ? (
                <button
                  type="button"
                  onClick={() => closeTerminalTab(id)}
                  aria-label={t('dock.closeTerminalTab')}
                  title={t('dock.closeTerminalTab')}
                  className="inline-flex size-4 items-center justify-center rounded opacity-60 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          ))}
          {canAdd ? (
            <button
              type="button"
              onClick={() => createTerminalTab(cwd ?? null)}
              aria-label={t('dock.newTerminalTab')}
              title={t('dock.newTerminalTab')}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          ) : null}
          {/* Desktop font +/- (item B optional). Hidden on touch where pinch covers it. */}
          <div className="ml-auto hidden shrink-0 items-center gap-1 md:flex">
            <button
              type="button"
              onClick={() => nudgeTerminalFont(-1)}
              aria-label={t('dock.fontDecrease')}
              title={t('dock.fontDecrease')}
              className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => nudgeTerminalFont(1)}
              aria-label={t('dock.fontIncrease')}
              title={t('dock.fontIncrease')}
              className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}
      <TerminalView className={`flex-1 min-h-0 ${className ?? ''}`} />
    </div>
  )
}
