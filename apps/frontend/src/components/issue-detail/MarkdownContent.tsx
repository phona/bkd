import * as React from 'react'
import { code } from '@streamdown/code'
import { mermaid } from '@streamdown/mermaid'
import { Streamdown, type Components as StreamdownComponents, type ExtraProps } from 'streamdown'
import { PathChip, sortKnownPaths, transformChildrenWithPathChips } from '@/lib/path-chips'

const { useMemo } = React

/**
 * Render an inline assistant / user message as streaming-friendly Markdown.
 *
 * Uses `streamdown` instead of `react-markdown` so the content can be updated
 * token-by-token without re-parsing the whole message. Code blocks and Mermaid
 * diagrams are handled by official streamdown plugins.
 *
 * Path chips still work via component overrides:
 *  - inline `<code>` whose entire content is a known path becomes a chip
 *  - plain text inside <p>/<li>/<td>/<em>/<strong> is scanned for known paths
 */
export function MarkdownContent({
  content,
  className: containerClassName = '',
  knownPaths,
  onPathClick,
  isStreaming = false,
}: {
  content: string
  className?: string
  /**
   * Pre-sorted whitelist of file paths to recognize inside plain text.
   * When provided together with `onPathClick`, matched substrings become
   * clickable inline chips. When empty / undefined, text is rendered as-is.
   */
  knownPaths?: string[]
  /** Click handler bound to each generated path chip. */
  onPathClick?: (path: string, line?: number) => void
  /** True while the message is still being streamed in. */
  isStreaming?: boolean
}) {
  const chipsEnabled = !!onPathClick && !!knownPaths && knownPaths.length > 0
  const sortedPaths = useMemo(
    () => (knownPaths ? sortKnownPaths(knownPaths) : []),
    [knownPaths],
  )

  const components = useMemo<StreamdownComponents>(() => {
    const base: StreamdownComponents = {
      a: MarkdownAnchor,
    }
    if (chipsEnabled) {
      base.inlineCode = (props: React.JSX.IntrinsicElements['code'] & ExtraProps) => (
        <MarkdownInlineCode {...props} sortedPaths={sortedPaths} onPathClick={onPathClick!} />
      )
      const transform = (children: React.ReactNode) =>
        transformChildrenWithPathChips(children, sortedPaths, onPathClick!)
      base.p = renderInlineTag('p', transform)
      base.li = renderInlineTag('li', transform)
      base.td = renderInlineTag('td', transform)
      base.em = renderInlineTag('em', transform)
      base.strong = renderInlineTag('strong', transform)
    }
    return base
  }, [chipsEnabled, sortedPaths, onPathClick])

  return (
    <div className={`markdown-chat ${containerClassName}`}>
      <Streamdown
        className="streamdown-markdown"
        components={components}
        isAnimating={isStreaming}
        plugins={{ code, mermaid }}
      >
        {content}
      </Streamdown>
    </div>
  )
}

function MarkdownAnchor(props: React.JSX.IntrinsicElements['a'] & ExtraProps) {
  return (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    />
  )
}

function MarkdownInlineCode({
  children,
  sortedPaths,
  onPathClick,
  ...rest
}: React.JSX.IntrinsicElements['code'] & ExtraProps & {
  sortedPaths: string[]
  onPathClick: (path: string, line?: number) => void
}) {
  const text = String(children ?? '')
  const segments = splitByKnownPathsForCode(text.trim(), sortedPaths)
  if (segments && segments.length === 1 && segments[0]!.type === 'path') {
    const seg = segments[0] as import('@/lib/path-chips').PathChipSegment
    return (
      <PathChip
        path={seg.path}
        line={seg.line}
        matched={seg.matched}
        onClick={onPathClick}
      />
    )
  }
  return (
    <code
      {...rest}
      className="rounded bg-muted/80 px-1.5 py-0.5 text-[0.9em] font-mono ring-1 ring-border/50 whitespace-nowrap"
    >
      {children}
    </code>
  )
}

function renderInlineTag(
  tag: 'p' | 'li' | 'td' | 'em' | 'strong',
  transform: (children: React.ReactNode) => React.ReactNode,
) {
  return ({ children, ...rest }: React.JSX.IntrinsicElements[typeof tag] & ExtraProps) =>
    React.createElement(tag, rest, transform(children))
}

/**
 * Lightweight path scan for inline code contents. Differs from the full
 * `splitByKnownPaths` in that it only returns a single segment when the whole
 * inline code is one known path (we don't want to chip-ify partial strings).
 */
function splitByKnownPathsForCode(
  text: string,
  sortedPaths: string[],
): import('@/lib/path-chips').Segment[] | null {
  if (!text || sortedPaths.length === 0) return null

  for (const path of sortedPaths) {
    const idx = text.indexOf(path)
    if (idx === -1) continue

    const endOfPath = idx + path.length
    let matchEnd = endOfPath
    let line: number | undefined
    const suffixMatch = text.slice(endOfPath).match(/^:(\d+)(?:-\d+)?/)
    if (suffixMatch) {
      matchEnd = endOfPath + suffixMatch[0].length
      line = Number.parseInt(suffixMatch[1]!, 10)
    }

    if (idx === 0 && matchEnd === text.length) {
      return [{ type: 'path', path, matched: text, line }]
    }
  }

  return null
}
