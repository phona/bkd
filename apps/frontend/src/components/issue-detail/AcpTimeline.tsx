import type { AcpTimelineItem } from '@/hooks/use-acp-timeline'
import type { NormalizedLogEntry, TimelineEntry } from '@bkd/shared'
import { CheckCircle2, Circle, Lightbulb, ListTodo, Loader2 } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { useAcpTimeline } from '@/hooks/use-acp-timeline'
import { useChatSearchStore } from '@/stores/chat-search-store'
import { useViewModeStore } from '@/stores/view-mode-store'
import { LogEntry } from './LogEntry'
import { ToolGroupMessage } from './ToolItems'
import type { VirtuosoHandle } from 'react-virtuoso'

// Base index for Virtuoso's jump-free prepend (inverse infinite scroll).
const ACP_FIRST_INDEX_BASE = 1_000_000

/** Stable DB message id for an item, used for search-jump + the highlight anchor. */
function itemMessageId(item: AcpTimelineItem): string | undefined {
  if (item.type === 'tool-group') return item.message.items[0]?.action.messageId
  return item.entry.messageId
}

/** Briefly flash a yellow ring on a jumped-to message bubble. */
function flashHighlight(el: Element) {
  el.classList.add('bkd-search-flash')
  setTimeout(() => el.classList.remove('bkd-search-flash'), 1800)
}

/**
 * Scroll the bubble for `messageId` into view inside `root` and flash it.
 * Polls briefly because virtualized rows mount a frame or two after the
 * Virtuoso `scrollToIndex` call brings them into range.
 */
function scrollToMessage(root: HTMLElement | null, messageId: string) {
  if (!root) return
  let tries = 0
  const tick = () => {
    const el = root.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      flashHighlight(el)
      return
    }
    if (tries++ < 40) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/** `/command` user-message rendered as a collapsed <details> with its output. */
const AcpCommandCard = memo(({
  entry,
  output,
}: {
  entry: NormalizedLogEntry
  output?: NormalizedLogEntry
}) => (
  <div className="group py-1.5 animate-message-enter">
    <details className="rounded-lg border border-border/30 bg-muted/10 transition-all duration-200 open:bg-muted/20">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted-foreground hover:bg-muted/20 transition-colors">
        <code className="font-mono text-foreground/70">{entry.content}</code>
      </summary>
      {output
        ? (
            <div className="px-3 pb-3 pt-1.5 border-t border-border/20">
              <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                {output.content}
              </pre>
            </div>
          )
        : null}
    </details>
  </div>
))

const AcpPlanCard = memo(({
  entry,
  todos,
  completedCount,
}: {
  entry: NormalizedLogEntry
  todos: Array<{ content: string, status: string, activeForm?: string }>
  completedCount: number
}) => {
  const { t } = useTranslation()
  const title = entry.content.trim() || 'Plan updated'

  return (
    <div className="animate-message-enter py-1.5">
      <div className="border border-border/60 bg-card/40">
        <div className="flex items-center gap-2 border-b border-border/20 px-3 py-2 text-xs text-muted-foreground">
          <ListTodo className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="font-medium">{t('session.tool.taskPlan')}</span>
          <span className="text-muted-foreground/50">
            (
            {completedCount}
            /
            {todos.length}
            )
          </span>
          <span className="truncate text-muted-foreground/70">{title}</span>
        </div>
        <div className="space-y-1 px-3 py-2">
          {todos.map((todo, idx) => (
            <div key={`${todo.content}-${idx}`} className="flex items-start gap-1.5 text-xs">
              {todo.status === 'completed' ?
                  (
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                  ) :
                todo.status === 'in_progress' ?
                    (
                      <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-blue-500" />
                    ) :
                    (
                      <Circle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                    )}
              <span
                className={
                  todo.status === 'completed' ?
                    'text-muted-foreground/60 line-through' :
                    todo.status === 'in_progress' ?
                      'text-blue-600 dark:text-blue-400' :
                      ''
                }
              >
                {todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

/** Real-time streaming thinking block — full content with auto-scroll. */
const StreamingThinking = memo(({ entry }: { entry: NormalizedLogEntry }) => {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = contentRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entry.content])

  return (
    <div className="my-1">
      <div className="border border-violet-300/20 dark:border-violet-500/15 bg-violet-500/[0.02] dark:bg-violet-500/[0.02] rounded-sm">
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-violet-500/50 dark:text-violet-400/50">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          <span className="font-medium">{t('session.thinking')}</span>
        </div>
        <div className="px-3 pb-2 pt-0.5 border-t border-violet-300/10 dark:border-violet-500/10">
          <pre
            ref={contentRef}
            className="text-xs text-violet-600/50 dark:text-violet-300/40 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-[300px] overflow-y-auto scroll-smooth"
          >
            {entry.content}
          </pre>
        </div>
      </div>
    </div>
  )
})

/**
 * Completed thinking block — expanded by default so switching out of
 *  streaming mode doesn't visually collapse all thinking content.
 */
const CompletedThinking = memo(({ entry }: { entry: NormalizedLogEntry }) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div className="animate-message-enter my-1">
      <div className="bg-violet-500/[0.02] border border-violet-300/15 dark:border-violet-500/10 rounded-sm">
        <button
          type="button"
          onClick={() => setIsOpen(v => !v)}
          className="w-full cursor-pointer px-3 py-1.5 text-xs text-violet-500/50 dark:text-violet-400/50 hover:bg-violet-500/[0.03] transition-colors flex items-center gap-2"
        >
          <Lightbulb className="h-3 w-3 shrink-0" />
          <span className="font-medium">{t('session.thoughtProcess')}</span>
          <span className="ml-auto text-[10px] opacity-50">
            {isOpen ? '收起' : '展开'}
          </span>
        </button>
        {isOpen && (
          <div className="px-3 pb-2 pt-1 border-t border-violet-300/10 dark:border-violet-500/10">
            <pre className="text-xs text-violet-600/50 dark:text-violet-300/40 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-[400px] overflow-y-auto">
              {entry.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
})

export function AcpTimeline({
  logs,
  scrollRef,
  isRunning = false,
  onEditPending,
  hasOlderLogs = false,
  isLoadingOlder = false,
  onLoadOlder,
}: {
  logs: TimelineEntry[]
  scrollRef?: React.RefObject<HTMLDivElement | null>
  isRunning?: boolean
  onEditPending?: (messageId: string) => void
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
}) {
  const { t } = useTranslation()
  const fullWidthChat = useViewModeStore(s => s.fullWidthChat)
  const { items, pendingMessages } = useAcpTimeline(logs)

  // Virtuoso virtualizes the timeline inside ChatBody's shared scroll
  // container (customScrollParent), so the existing scroll machinery — title
  // auto-hide, saved-position restore, scroll buttons — keeps working on the
  // same element. Prepend (load older) anchoring + bottom-follow are owned by
  // Virtuoso, replacing the hand-rolled scrollHeight-delta compensation that
  // could not match mainstream chat quality.
  // Resolve the shared scroll container for Virtuoso's customScrollParent.
  // No dep array on purpose: `scrollRef.current` is populated by a commit on an
  // ANCESTOR (ChatBody's scroll div), which is not reliably available the single
  // time a `[scrollRef]` effect would run on mount — on an in-app issue switch
  // it was still null, leaving customScrollParent null so Virtuoso rendered
  // NOTHING (the "messages don't load until a hard refresh" bug). Running every
  // commit and updating only on change catches the element as soon as it mounts,
  // with no render loop.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = scrollRef?.current ?? null
    setScrollEl(prev => (prev === el ? prev : el))
  })

  // In-chat search jump (ported from Legacy). Bring the target item into the
  // DOM via Virtuoso's scrollToIndex (rows are virtualized, so an off-screen
  // target isn't mounted yet), then scroll + flash the bubble by data-message-id.
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const jumpNonce = useChatSearchStore(s => s.jumpNonce)
  const jumpMessageId = useChatSearchStore(s => s.jumpMessageId)
  useEffect(() => {
    if (!jumpMessageId) return
    const idx = items.findIndex(it => itemMessageId(it) === jumpMessageId)
    if (idx >= 0) virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' })
    // A second pass after layout settles — dynamically-measured rows can shift
    // the first estimate, same as the old VirtualMessageList jump.
    requestAnimationFrame(() => {
      if (idx >= 0) virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center' })
      scrollToMessage(scrollRef?.current ?? null, jumpMessageId)
    })
  }, [jumpNonce, jumpMessageId, items, scrollRef])

  // firstItemIndex bookkeeping for jump-free prepend (inverse infinite scroll):
  // start high, decrement by the number of items prepended; Virtuoso uses the
  // index shift to hold the user's position instead of snapping to the new top.
  //
  // CRITICAL: firstItemIndex must change in the SAME render as `items`. Doing it
  // in an effect lags one frame — Virtuoso renders the longer list with the
  // stale index and jumps to the new top (the "I don't know where I am" symptom).
  // React's "adjust state during render when an input changes" pattern keeps the
  // data and the index in lockstep.
  const [firstItemIndex, setFirstItemIndex] = useState(ACP_FIRST_INDEX_BASE)
  const [prevSig, setPrevSig] = useState<{ len: number, firstId: string | undefined }>({
    len: items.length,
    firstId: items[0]?.id,
  })
  const firstId = items[0]?.id
  if (prevSig.len !== items.length || prevSig.firstId !== firstId) {
    if (
      items.length > prevSig.len
      && prevSig.firstId !== undefined
      && firstId !== prevSig.firstId
    ) {
      setFirstItemIndex(i => i - (items.length - prevSig.len))
    }
    setPrevSig({ len: items.length, firstId })
  }

  if (items.length === 0 && pendingMessages.length === 0 && !isRunning) return null

  const itemClass = fullWidthChat ? 'px-4' : 'mx-auto w-full max-w-3xl px-4'

  const context: AcpListContext = {
    isLoadingOlder,
    loadingLabel: t('common.loading'),
    editLabel: t('common.edit'),
    pendingMessages,
    onEditPending,
    itemClass,
  }

  // Virtuoso owns virtualization, jump-free prepend, and bottom-follow, all
  // inside ChatBody's shared scroll container (customScrollParent). Render only
  // once that element is available so Virtuoso never spins up its own nested
  // scroller. Header = load-older spinner; Footer = pending (unsent) messages.
  if (!scrollEl) return null

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={items}
      context={context}
      customScrollParent={scrollEl}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={Math.max(0, items.length - 1)}
      followOutput="auto"
      startReached={() => {
        if (hasOlderLogs && !isLoadingOlder) onLoadOlder?.()
      }}
      computeItemKey={(_index, item) => item.id}
      itemContent={(_index, item) => (
        <div className={`${itemClass} py-1.5`} data-message-id={itemMessageId(item)}>
          {item.type === 'tool-group'
            ? (
                <div className="group">
                  {item.thinking && (
                    <div className="mb-1.5"><CompletedThinking entry={item.thinking} /></div>
                  )}
                  <ToolGroupMessage message={item.message} />
                </div>
              )
            : item.type === 'plan'
              ? (
                  <AcpPlanCard entry={item.entry} todos={item.todos} completedCount={item.completedCount} />
                )
              : item.type === 'command'
                ? (
                    <AcpCommandCard entry={item.entry} output={item.output} />
                  )
                : item.type === 'thinking'
                  ? (item.isStreaming && isRunning
                      ? <StreamingThinking entry={item.entry} />
                      : <CompletedThinking entry={item.entry} />)
                  : item.type === 'entry'
                    ? (
                        <div className="group">
                          {item.thinking && (
                            <div className="mb-1.5"><CompletedThinking entry={item.thinking} /></div>
                          )}
                          <LogEntry entry={item.entry} />
                        </div>
                      )
                    : null}
        </div>
      )}
      components={{ Header: AcpListHeader, Footer: AcpListFooter }}
    />
  )
}

interface AcpListContext {
  isLoadingOlder: boolean
  loadingLabel: string
  editLabel: string
  pendingMessages: NormalizedLogEntry[]
  onEditPending?: (messageId: string) => void
  itemClass: string
}

function AcpListHeader({ context }: { context?: AcpListContext }) {
  if (!context?.isLoadingOlder) return null
  return (
    <div className={`${context.itemClass} flex justify-center py-2`}>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {context.loadingLabel}
      </span>
    </div>
  )
}

function AcpListFooter({ context }: { context?: AcpListContext }) {
  if (!context || context.pendingMessages.length === 0) return null
  const { pendingMessages, onEditPending, editLabel, itemClass } = context
  return (
    <div className={`${itemClass} mt-1 border-t border-border/30 pt-2`}>
      {pendingMessages.map((entry, idx) => (
        <div key={entry.messageId ?? `acp-pending-${idx}`} className="group relative">
          <LogEntry entry={entry} />
          {onEditPending
            ? (
                <button
                  type="button"
                  onClick={() => onEditPending(entry.messageId ?? `acp-pending-${idx}`)}
                  className="absolute right-2 top-2 hidden rounded-md border border-border/40 bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground group-hover:inline-flex"
                >
                  {editLabel}
                </button>
              )
            : null}
        </div>
      ))}
    </div>
  )
}
