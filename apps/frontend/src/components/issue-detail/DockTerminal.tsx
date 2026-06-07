import { useEffect, useState } from 'react'
import { disposeTerminal, TerminalView } from '@/components/terminal/TerminalView'
import { useTerminalStore } from '@/stores/terminal-store'

/**
 * Terminal host for the issue-detail dock (PLAN-036).
 *
 * Lifecycle contract:
 *  - The PTY is spawned only once this component mounts (i.e. the user has
 *    actually opened the terminal tab/overlay for the first time). Parents
 *    keep it mounted afterwards and hide it via CSS — the PTY survives tab
 *    switches and rail open/close (keep-alive).
 *  - On unmount (issue change / navigate away / mobile→desktop flip) the PTY
 *    is disposed. This is the BUG-004 guarantee: hidden ≠ leaked, but the
 *    session is always torn down when the host genuinely goes away.
 *
 * The cwd is applied BEFORE the inner <TerminalView> mounts (gated behind
 * `ready`) so the very first connection starts in the issue's worktree dir
 * rather than the default cwd — child effects run before parent effects, so
 * we must arm the pending cwd before rendering the child.
 */
export function DockTerminal({ cwd, className }: { cwd?: string | null, className?: string }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (cwd) useTerminalStore.getState().openInDir(cwd)
    setReady(true)
    return () => {
      disposeTerminal()
    }
    // Run exactly once: cwd is captured at first open; later "open terminal
    // here" clicks drive openInDir directly (restartToken bump).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return ready ? <TerminalView className={className} /> : null
}
