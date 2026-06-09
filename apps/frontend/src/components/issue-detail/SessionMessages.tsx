import type { TimelineEntry } from '@bkd/shared'
import { AcpTimeline } from './AcpTimeline'

// ── SessionMessages (main export) ────────────────────────
//
// PLAN-043: a single chat renderer for ALL engines. This is now a thin
// wrapper around AcpTimeline (Virtuoso-based, reliable scroll-anchor, renders
// pending, backend-aligned). The legacy claude-code renderer + use-chat-messages
// grouping hook were deleted — claude-code, codex, and every ACP agent share
// this one timeline. `engineType` is still accepted for signature stability but
// no longer switches renderers.

export function SessionMessages(props: {
  logs: TimelineEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  engineType?: string
  isRunning?: boolean
  workingStep?: string | null
  onCancel?: () => void
  isCancelling?: boolean
  onEditPending?: (messageId: string) => void
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
  savedScroll?: number
}) {
  const {
    logs,
    scrollRef,
    isRunning,
    onEditPending,
    hasOlderLogs,
    isLoadingOlder,
    onLoadOlder,
  } = props

  return (
    <AcpTimeline
      logs={logs}
      scrollRef={scrollRef}
      isRunning={isRunning}
      onEditPending={onEditPending}
      hasOlderLogs={hasOlderLogs}
      isLoadingOlder={isLoadingOlder}
      onLoadOlder={onLoadOlder}
    />
  )
}
