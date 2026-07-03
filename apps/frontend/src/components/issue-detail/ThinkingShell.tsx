import { ChevronRight, Lightbulb, Loader2 } from 'lucide-react'
import { memo, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizedLogEntry } from '@bkd/shared'

interface ThinkingShellProps {
  entry: NormalizedLogEntry
  isStreaming?: boolean
}

export const ThinkingShell = memo(function ThinkingShell({
  entry,
  isStreaming = false,
}: ThinkingShellProps) {
  const { t } = useTranslation()
  const bodyId = useId()
  // Collapse completed thinking by default so it doesn't push the assistant
  // reply down the screen. Keep streaming thinking open so users can watch
  // live reasoning as it arrives.
  const [isOpen, setIsOpen] = useState(isStreaming)
  const contentRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!isStreaming) return
    const el = contentRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entry.content, isStreaming])

  const label = isStreaming ? t('session.thinking') : t('session.thoughtProcess')

  return (
    <div className="my-1.5 overflow-hidden rounded-r-md border-l-2 border-violet-300/25 bg-violet-500/[0.03] dark:border-violet-500/25 dark:bg-violet-500/[0.03]">
      <button
        type="button"
        onClick={() => !isStreaming && setIsOpen(v => !v)}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-violet-500/[0.04]"
      >
        {isStreaming
          ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
            )
          : (
              <>
                <ChevronRight
                  className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                />
                <Lightbulb className="h-3 w-3 shrink-0" aria-hidden="true" />
              </>
            )}
        <span className="font-medium">{label}</span>
        {!isStreaming && (
          <span className="ml-auto text-[10px] opacity-50">
            {isOpen ? t('common.collapse') : t('common.expand')}
          </span>
        )}
      </button>
      {isOpen && (
        <div
          id={bodyId}
          className="border-t border-violet-300/10 px-3 pb-2.5 pt-1.5 dark:border-violet-500/10"
        >
          <pre
            ref={contentRef}
            className="max-h-[300px] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground/80 scroll-smooth"
          >
            {entry.content}
          </pre>
        </div>
      )}
    </div>
  )
})
