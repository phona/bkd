import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AcpTimeline } from '@/components/issue-detail/AcpTimeline'
import type { NormalizedLogEntry, TimelineEntry } from '@/types/kanban'

// Mock react-i18next to avoid i18n initialization in tests
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

// Virtuoso virtualizes with real layout, which jsdom does not provide — it
// renders nothing in tests. Mock it to render every item inline so we can
// assert on the rendered timeline. A button exposes `startReached` so the
// auto-load-older path can be exercised without a real scroll.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data = [], itemContent, startReached }: {
    data?: unknown[]
    itemContent: (index: number, item: unknown) => ReactNode
    startReached?: () => void
  }) => (
    <div data-testid="virtuoso">
      <button type="button" data-testid="virtuoso-start" onClick={() => startReached?.()}>
        start
      </button>
      {data.map((item, i) => (
        <div key={(item as { id?: string }).id ?? i}>{itemContent(i, item)}</div>
      ))}
    </div>
  ),
}))

beforeAll(() => {
  // Mock matchMedia for theme detection in jsdom
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

// AcpTimeline only mounts Virtuoso once its scroll parent exists (scrollEl from
// scrollRef). Wrap it in a scroll container so the timeline renders in tests.
function renderTimeline(logs: TimelineEntry[], props: { isRunning?: boolean } = {}) {
  function Harness() {
    const scrollRef = useRef<HTMLDivElement>(null)
    // Mount the scroll container first so its ref is attached before AcpTimeline's
    // layout effect reads scrollRef.current (mirrors production, where the scroll
    // parent exists before the timeline mounts).
    const [ready, setReady] = useState(false)
    useLayoutEffect(() => {
      setReady(true)
    }, [])
    return (
      <div ref={scrollRef} data-testid="scroll" style={{ height: 500, overflow: 'auto' }}>
        {ready && <AcpTimeline logs={logs} scrollRef={scrollRef} {...props} />}
      </div>
    )
  }
  return render(<Harness />, { wrapper: createWrapper() })
}

function toTimeline(entries: NormalizedLogEntry[]): TimelineEntry[] {
  return entries.map((entry) => {
    const typeMap: Record<string, TimelineEntry['type']> = {
      'thinking': 'thinking',
      'assistant-message': 'assistant',
      'tool-use': 'tool',
      'system-message': 'system',
      'error-message': 'error',
      'user-message': 'user',
    }
    const type = typeMap[entry.entryType] ?? 'system'
    const turn = entry.turnIndex ?? 0
    return {
      ...entry,
      id: entry.messageId ?? `turn-${turn}-${type}`,
      type,
    }
  })
}

describe('acpTimeline', () => {
  it('renders a single assistant message when thinking and message share content', () => {
    // Regression: OpenCode sends thinking chunks with the same content as
    // assistant-message. The UI should not show a separate thinking entry.
    // Backend TimelineConverter already merges cascading chunks.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: 'Hello world',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    renderTimeline(toTimeline(logs))

    // Only one assistant message should be rendered
    const messages = screen.getAllByText(/Hello/)
    expect(messages.length).toBe(1)
    expect(messages[0]).toHaveTextContent('Hello world')
  })

  it('renders merged timeline without duplication', () => {
    // Backend TimelineConverter already merges chunks into single entries.
    // Frontend only renders the normalized result.
    const finalContent = '用户'.repeat(5) + '，这是回复内容'.repeat(10) + '后续内容'.repeat(5)
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '用户'.repeat(5),
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: false },
      },
      {
        entryType: 'tool-use',
        content: 'Read src/config.ts',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: finalContent,
        timestamp: new Date(Date.now() + 200).toISOString(),
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    renderTimeline(toTimeline(logs))

    // Should NOT show streaming thinking indicator
    expect(screen.queryByText('session.thinking')).not.toBeInTheDocument()

    // Should have exactly ONE assistant message rendered
    expect(screen.getByText(finalContent)).toBeInTheDocument()

    // Tool call body is collapsed by default — expand it first
    const toolHeader = screen.getByRole('button', { expanded: false })
    fireEvent.click(toolHeader)

    // Tool call should be present
    expect(screen.queryAllByText('Read src/config.ts').length).toBeGreaterThanOrEqual(1)
  })

  it('shows completed thinking expanded by default when thinking finishes', () => {
    // UX: thinking streams in real-time, then collapses when assistant starts.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me analyze the problem',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'The issue is in the type definitions',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    renderTimeline(toTimeline(logs))

    // Completed thinking is expanded by default so it stays visible across view
    // switches; the header toggles it.
    expect(screen.getByText('session.thoughtProcess')).toBeInTheDocument()
    expect(screen.getByText(/Let me analyze the problem/)).toBeInTheDocument()

    // Clicking the header collapses it (content unmounts).
    fireEvent.click(screen.getByText('session.thoughtProcess'))
    expect(screen.queryByText(/Let me analyze the problem/)).not.toBeInTheDocument()

    // The assistant message is shown regardless.
    expect(screen.getByText(/The issue is/)).toBeInTheDocument()
  })

  it('shows streaming thinking in real-time before assistant arrives', () => {
    // Simulate mid-stream: only thinking chunks received so far
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Analyzing the codebase...',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    renderTimeline(toTimeline(logs), { isRunning: true })

    // Should show streaming thinking content (i18n label not loaded in tests)
    expect(screen.getByText(/Analyzing the codebase/)).toBeInTheDocument()
  })

  it('keeps thinking block even when assistant repeats the same prefix', () => {
    // Models commonly open the reply with the same opening sentence as the
    // reasoning. The old startsWith-dedup silently dropped the thinking
    // block in that case — users perceived it as "thinking disappeared
    // after refresh". Now thinking is its own surface; collapse it via the
    // <details> element if visual duplication bothers you.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '让我分析这个问题',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: false },
      },
      {
        entryType: 'assistant-message',
        content: '让我分析这个问题\n\n答案是42',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    renderTimeline(toTimeline(logs))

    // Thinking block is rendered (i18n label visible).
    expect(screen.getByText('session.thoughtProcess')).toBeInTheDocument()
    // Assistant body is rendered.
    expect(screen.getByText(/答案是42/)).toBeInTheDocument()
  })

  it('preserves thinking block when assistant has different content', () => {
    // Normal case: thinking and assistant are distinct — both should show.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me check the logs',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: false },
      },
      {
        entryType: 'assistant-message',
        content: 'The error is on line 42',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    renderTimeline(toTimeline(logs))

    // Should show the thinking block
    expect(screen.getByText('session.thoughtProcess')).toBeInTheDocument()

    // Should show the assistant message
    expect(screen.getByText(/The error is on line 42/)).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Auto-load older history — IntersectionObserver wiring.
// Mirror of the SessionMessages regression test. AcpTimeline is the path
// opencode / gemini issues take, so without this guard the scroll-up-to-
// load bug would have stayed alive for ACP engines even after the legacy
// (Claude / codex) path was fixed.
// ────────────────────────────────────────────────────────────────────────────

describe('acpTimeline — auto-load older history', () => {
  beforeEach(() => {
    // jsdom doesn't implement Element.scrollTo; AcpTimeline calls it after
    // messages arrive. Stub so the auto-bottom effect doesn't throw mid-rerender.
    Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo']
  })

  interface HarnessProps {
    logs: TimelineEntry[]
    hasOlderLogs?: boolean
    isLoadingOlder?: boolean
    onLoadOlder?: () => void
  }

  function Harness({ logs, hasOlderLogs, isLoadingOlder, onLoadOlder }: HarnessProps) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [ready, setReady] = useState(false)
    useLayoutEffect(() => {
      setReady(true)
    }, [])
    return (
      <div ref={scrollRef} data-testid="scroll" style={{ height: 500, overflow: 'auto' }}>
        {ready && (
          <AcpTimeline
            logs={logs}
            scrollRef={scrollRef}
            hasOlderLogs={hasOlderLogs}
            isLoadingOlder={isLoadingOlder}
            onLoadOlder={onLoadOlder}
          />
        )}
      </div>
    )
  }

  function userEntry(messageId: string, content: string): TimelineEntry {
    return {
      id: `turn-0-user-${messageId}`,
      messageId,
      turnIndex: 0,
      type: 'user',
      entryType: 'user-message',
      content,
      timestamp: new Date().toISOString(),
      sequence: 1000,
      metadata: {},
    } as TimelineEntry
  }

  it('loads older history when Virtuoso reaches the start, and only when more exist', () => {
    // AcpTimeline delegates inverse-infinite-scroll to Virtuoso's startReached.
    // Reaching the start loads older history — but only when more exist and a
    // load is not already in flight (AcpTimeline guards the callback).
    const onLoadOlder = vi.fn()
    const { rerender } = render(
      <Harness logs={[userEntry('a', 'hello')]} hasOlderLogs onLoadOlder={onLoadOlder} />,
      { wrapper: createWrapper() },
    )

    fireEvent.click(screen.getByTestId('virtuoso-start'))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)

    // While a load is already in flight, reaching the start again is a no-op.
    rerender(
      <Harness logs={[userEntry('a', 'hello')]} hasOlderLogs isLoadingOlder onLoadOlder={onLoadOlder} />,
    )
    fireEvent.click(screen.getByTestId('virtuoso-start'))
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })
})
