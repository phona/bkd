import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { useAcpTimeline } from '@/hooks/use-acp-timeline'
import type { NormalizedLogEntry, TimelineEntry } from '@/types/kanban'

beforeAll(() => {
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

/**
 * Test helper that mimics what the backend `TimelineConverter` produces:
 *   - sort by timestamp (chronological)
 *   - assign monotonic `sequence`
 *   - segment-aware ids for thinking/assistant when interrupted by tools
 *
 * Frontend `useAcpTimeline` is a pure mapping over already-converted
 * TimelineEntry — these tests must feed it post-conversion data.
 */
function toTimeline(entries: NormalizedLogEntry[]): TimelineEntry[] {
  const typeMap: Record<string, TimelineEntry['type']> = {
    'thinking': 'thinking',
    'assistant-message': 'assistant',
    'tool-use': 'tool',
    'system-message': 'system',
    'error-message': 'error',
    'user-message': 'user',
  }
  const sorted = [...entries].sort((a, b) => {
    const ta = a.turnIndex ?? 0
    const tb = b.turnIndex ?? 0
    if (ta !== tb) return ta - tb
    const tsa = a.timestamp ? new Date(a.timestamp).getTime() : 0
    const tsb = b.timestamp ? new Date(b.timestamp).getTime() : 0
    return tsa - tsb
  })
  // Track segment counters so multi-segment thinking/assistant get distinct ids
  const segCount: Record<string, Record<string, number>> = {}
  const lastNonStreaming: Record<number, string | null> = {}
  return sorted.map((entry, idx) => {
    const type = typeMap[entry.entryType] ?? 'system'
    const turn = entry.turnIndex ?? 0
    let id: string
    if (type === 'thinking' || type === 'assistant') {
      const turnSeg = segCount[turn] ?? (segCount[turn] = {})
      // If the previous entry within this turn was a different streaming type
      // (or a tool/non-streaming), bump segment count.
      const last = lastNonStreaming[turn]
      if (last && last !== type) turnSeg[type] = (turnSeg[type] ?? -1) + 1
      const segIdx = turnSeg[type] ?? 0
      turnSeg[type] = segIdx
      id = segIdx === 0 ? `turn-${turn}-${type}` : `turn-${turn}-${type}-${segIdx}`
      lastNonStreaming[turn] = type
    } else {
      id = entry.messageId ?? `turn-${turn}-${type}-${idx}`
      lastNonStreaming[turn] = type === 'tool' ? 'tool' : type
    }
    return {
      ...entry,
      id,
      type,
      sequence: idx,
    }
  })
}

function rebuildAcpTimeline(logs: NormalizedLogEntry[]) {
  const { result } = renderHook(() => useAcpTimeline(toTimeline(logs)), { wrapper: createWrapper() })
  return result.current
}

describe('useAcpTimeline rendering', () => {
  it('keeps thinking when assistant starts with the same prefix (no startsWith dedup)', () => {
    // Models routinely open the reply with the same sentence as the reasoning
    // ("让我看看 X" → "让我看看 X，发现..."). The old startsWith-based dedup
    // silently removed the thinking block in that case, which users perceived
    // as "刷新后思考没了". Thinking is its own surface — keep it. If users
    // dislike the duplicated opener they can collapse the thinking <details>.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '用户问为什么测试兜不住',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: '用户问为什么测试兜不住。原因是测试只覆盖了 normalizer，没测前端 state 的去重',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('entry')
    expect((items[0] as any).thinking).toBeDefined()
    expect((items[0] as any).thinking!.content).toBe('用户问为什么测试兜不住')
  })

  it('keeps thinking across tool groups when assistant has different content', () => {
    // When the assistant does NOT repeat the thinking prefix, both should be
    // preserved — the thinking block shows the reasoning process, and the
    // assistant shows the final reply.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me check the imports first',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'tool-use',
        content: 'Read src/app.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        messageId: 't1',
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: 'I found the issue in the type definitions',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // 2 items: tool-group (with attached thinking) + assistant
    expect(items).toHaveLength(2)
    expect(items[0]!.type).toBe('tool-group')
    expect((items[0] as any).thinking).toBeDefined()
    expect(items[1]!.type).toBe('entry')
    expect((items[1] as any).thinking).toBeUndefined()
  })

  it('keeps standalone thinking when assistant does NOT overlap', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me check the imports first',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'I found the issue in the type definitions',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // 1 item: entry with attached thinking
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('entry')
    expect((items[0] as any).thinking).toBeDefined()
    expect((items[0] as any).thinking!.content).toBe('Let me check the imports first')

    expect((items[0] as { entry: NormalizedLogEntry }).entry.entryType).toBe('assistant-message')
  })

  it('folds trailing thinking back above the assistant response when reasoning arrives late', () => {
    // OpenCode/ACP sometimes emits the assistant reply before the reasoning
    // update. The backend then sorts thinking after the reply, which would make
    // it render below the response. It should still appear above.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: '方案整体框架非常扎实',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
      {
        entryType: 'thinking',
        content: '用户发了一份详细的方案，我需要先查看工作目录',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        metadata: { streaming: false },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('entry')
    expect((items[0] as any).entry.entryType).toBe('assistant-message')
    expect((items[0] as any).thinking).toBeDefined()
    expect((items[0] as any).thinking!.content).toBe('用户发了一份详细的方案，我需要先查看工作目录')
  })

  it('keeps thinking across tool groups when assistant starts with same prefix', () => {
    // Same scenario as above but with a tool burst between thinking and the
    // assistant reply. Thinking still preserved — see the no-startsWith-dedup
    // rationale above.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '用户问为什么测试兜不住',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'tool-use',
        content: 'Read src/app.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        messageId: 't1',
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: '用户问为什么测试兜不住。原因是测试只覆盖了 normalizer',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // 2 items: tool-group (with attached thinking) + entry
    expect(items).toHaveLength(2)
    expect(items[0]!.type).toBe('tool-group')
    expect((items[0] as any).thinking).toBeDefined()
    expect(items[1]!.type).toBe('entry')
  })
})

describe('useAcpTimeline — thinking preservation', () => {
  // Regression guard for the startsWith-dedup bug: models routinely open the
  // reply with the same sentence as the reasoning, so a heuristic that drops
  // thinking whenever assistant.startsWith(thinking) silently killed the
  // thinking block in real-world conversations. Now thinking is always kept.
  it('keeps short thinking when assistant happens to start with the same opening sentence', () => {
    const logs: NormalizedLogEntry[] = [
      {
        // Short thinking burst — engine emits one chunk before transitioning
        // to the actual reply. Common with OpenCode / Codex reasoning items.
        entryType: 'thinking',
        content: '让我看看这个 SQL 查询',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
      },
      {
        entryType: 'tool-use',
        content: 'Read db/schema.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        messageId: 't1',
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        // Final assistant content happens to lead with the same opener.
        // After this entry arrives (live tail OR /logs refresh), dedup fires.
        entryType: 'assistant-message',
        content: '让我看看这个 SQL 查询的具体问题。JOIN 条件写反了，应该用 inner join',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
      },
    ]

    const { items } = rebuildAcpTimeline(logs)
    expect(items).toHaveLength(2)
    expect(items[0]!.type).toBe('tool-group')
    expect((items[0] as any).thinking).toBeDefined()
    expect(items[1]!.type).toBe('entry')
  })
})

describe('useAcpTimeline streaming merge regression', () => {
  it('does NOT concatenate unrelated assistant chunks', () => {
    // Regression: when assistant chunks are not superset/subset,
    // they must NOT be concatenated into garbled text.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: 'Hello world',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'Hi there',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // Should NOT produce "Hello worldHi there"
    const assistantContents = items
      .filter(i => i.type === 'entry')
      .map(i => (i as { entry: NormalizedLogEntry }).entry.content)

    const concatenated = assistantContents.some(c =>
      c.includes('Hello world') && c.includes('Hi there'),
    )
    expect(concatenated).toBe(false)
  })

  it('handles cascading accumulated text correctly', () => {
    // ACP agents send full accumulated text on every chunk.
    // Should keep only the latest full text.
    // Backend TimelineConverter already merges cascading chunks.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: 'B里还留着历史销售记录，月份的报表还能看到这个"派对套餐"',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('entry')
    const entry = items[0] as { entry: NormalizedLogEntry }
    expect(entry.entry.content).toBe(
      'B里还留着历史销售记录，月份的报表还能看到这个"派对套餐"',
    )
  })

  it('keeps standalone thinking when assistant only partially overlaps', () => {
    // Regression: thinking contains additional content not in assistant.
    // Should keep thinking as standalone (not discard it).
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me analyze the SQL query carefully. The issue is in the JOIN clause.',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
      },
      {
        entryType: 'assistant-message',
        content: 'Let me analyze the SQL query carefully. Here is the fix:',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // Both thinking and assistant should be present
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('entry')
    expect((items[0] as any).thinking).toBeDefined()
    const assistant = items[0] as { entry: NormalizedLogEntry }
    expect(assistant.entry.entryType).toBe('assistant-message')
  })

  it('renders backend-merged consecutive thinking with content intact', () => {
    // Consecutive non-streaming thinking within a turn is merged by the backend
    // TimelineConverter (segments split only on tool/assistant boundaries), so
    // the frontend receives a single thinking entry. It must render that block
    // with all reasoning preserved, attached to the following assistant message.
    //
    // NOTE (open product question): the backend merges distinct Codex reasoning
    // items that have no tool call between them. If they should render as
    // separate blocks, that is a backend (timeline-converter) change.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me check the imports first\nNow let me read the actions file',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
      },
      {
        entryType: 'assistant-message',
        content: 'I found the issue in the type definitions',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('entry')
    const attached = (items[0] as { thinking?: NormalizedLogEntry }).thinking
    expect(attached).toBeDefined()
    expect(attached!.content).toContain('Let me check the imports first')
    expect(attached!.content).toContain('Now let me read the actions file')
  })

  it('stable order regardless of event arrival order', () => {
    // Backend assigns sequence based on chronological ingest order, and
    // useIssueStream sorts by sequence. The test helper here mimics that
    // by sorting on timestamp, so any input ordering of the same entries
    // produces the same output.
    const baseEntries: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'I need to check the database',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'tool-use',
        content: 'Read db/schema.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        messageId: 't1',
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: 'I found the issue',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const order1 = rebuildAcpTimeline(baseEntries).items.map(i => i.type)
    // Shuffle entries (different arrival order, same semantic content)
    const shuffled = [baseEntries[1], baseEntries[0], baseEntries[2]]
    const order2 = rebuildAcpTimeline(shuffled).items.map(i => i.type)

    expect(order1).toEqual(order2)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// PLAN-043: cases ported from the deleted use-chat-messages.test.tsx. The
// unified renderer (useAcpTimeline) must preserve PLAN-041 interleave + tool
// clustering, and render error / system / command entries the legacy
// claude-code renderer used to own.
// ────────────────────────────────────────────────────────────────────────────

function asst(text: string, seq: number): NormalizedLogEntry {
  return {
    entryType: 'assistant-message',
    content: text,
    timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
    turnIndex: 0,
    messageId: `am-${text}`,
  } as NormalizedLogEntry
}
function tool(id: string, seq: number): NormalizedLogEntry {
  return {
    entryType: 'tool-use',
    content: `Read ${id}`,
    timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
    turnIndex: 0,
    messageId: id,
    metadata: { toolCallId: id, isResult: false, toolName: 'Read' },
    toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: id, isResult: false },
  } as NormalizedLogEntry
}
function think(seq: number): NormalizedLogEntry {
  return {
    entryType: 'thinking',
    content: 'hmm',
    timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
    turnIndex: 0,
  } as NormalizedLogEntry
}

describe('useAcpTimeline — PLAN-041 interleaved tool/text timeline', () => {
  it('interleaves tools between assistant text segments by sequence', () => {
    // text → tool → text → tool → text must render with tool cards BETWEEN the
    // assistant segments — not all text merged with the tools yanked into a
    // trailing group.
    const { items } = rebuildAcpTimeline([
      asst('a', 0),
      tool('t1', 1),
      asst('b', 2),
      tool('t2', 3),
      asst('c', 4),
    ])
    expect(items.map(i => i.type)).toEqual(['entry', 'tool-group', 'entry', 'tool-group', 'entry'])
    expect(items.filter(i => i.type === 'entry').map(i => (i as any).entry.content)).toEqual(['a', 'b', 'c'])
    const groups = items.filter(i => i.type === 'tool-group') as Array<{ message: { count: number } }>
    expect(groups.map(g => g.message.count)).toEqual([1, 1])
  })

  it('clusters genuinely adjacent tools into a single tool-group', () => {
    const { items } = rebuildAcpTimeline([asst('a', 0), tool('t1', 1), tool('t2', 2), asst('b', 3)])
    expect(items.map(i => i.type)).toEqual(['entry', 'tool-group', 'entry'])
    expect((items[1] as { message: { count: number } }).message.count).toBe(2)
  })

  it('does not merge tools across an intervening thinking entry', () => {
    // The boundary holds: two separate tool-groups (the bursts don't merge).
    // In the unified renderer the thinking attaches to the following burst
    // rather than rendering standalone, but it still splits the cluster.
    const { items } = rebuildAcpTimeline([tool('t1', 1), think(2), tool('t2', 3)])
    expect(items.map(i => i.type)).toEqual(['tool-group', 'tool-group'])
    expect((items[1] as { thinking?: unknown }).thinking).toBeDefined()
  })

  it('keeps thinking-before-burst attached above the group', () => {
    const { items } = rebuildAcpTimeline([think(1), tool('t1', 2), tool('t2', 3)])
    expect(items.map(i => i.type)).toEqual(['tool-group'])
    expect((items[0] as { thinking?: unknown }).thinking).toBeDefined()
    expect((items[0] as { message: { count: number } }).message.count).toBe(2)
  })
})

describe('useAcpTimeline — error / system / command entries (ported from legacy)', () => {
  function errorEntry(seq: number): NormalizedLogEntry {
    return {
      entryType: 'error-message',
      content: 'boom: something failed',
      timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
      turnIndex: 0,
      messageId: `err-${seq}`,
    } as NormalizedLogEntry
  }
  function systemEntry(subtype: string, content: string, seq: number): NormalizedLogEntry {
    return {
      entryType: 'system-message',
      content,
      timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
      turnIndex: 0,
      messageId: `sys-${subtype}-${seq}`,
      metadata: { subtype },
    } as NormalizedLogEntry
  }

  it('renders an error-message as a timeline entry', () => {
    const { items } = rebuildAcpTimeline([asst('a', 0), errorEntry(1), asst('b', 2)])
    expect(items.map(i => i.type)).toEqual(['entry', 'entry', 'entry'])
    expect((items[1] as { entry: { entryType: string } }).entry.entryType).toBe('error-message')
  })

  it('treats an error-message as a tool-cluster boundary', () => {
    const { items } = rebuildAcpTimeline([tool('t1', 0), errorEntry(1), tool('t2', 2)])
    expect(items.map(i => i.type)).toEqual(['tool-group', 'entry', 'tool-group'])
    expect((items[1] as { entry: { entryType: string } }).entry.entryType).toBe('error-message')
  })

  it('renders an info system-message as a timeline entry', () => {
    const { items } = rebuildAcpTimeline([systemEntry('info', 'context compacted', 0)])
    expect(items).toHaveLength(1)
    expect((items[0] as { entry: { entryType: string } }).entry.entryType).toBe('system-message')
  })

  it('skips noisy system subtypes (task_progress / stop_hook_summary / task_notification)', () => {
    const { items } = rebuildAcpTimeline([
      systemEntry('task_progress', 'x', 0),
      systemEntry('stop_hook_summary', 'y', 1),
      systemEntry('task_notification', 'z', 2),
    ])
    expect(items).toHaveLength(0)
  })

  it('does not merge tools across a rendered system-message', () => {
    const { items } = rebuildAcpTimeline([tool('t1', 0), systemEntry('info', 'hi', 1), tool('t2', 2)])
    expect(items.map(i => i.type)).toEqual(['tool-group', 'entry', 'tool-group'])
  })

  it('folds a /command user-message + its output into one command item', () => {
    const command = {
      entryType: 'user-message',
      content: '/context',
      timestamp: '2026-01-01T00:00:00Z',
      turnIndex: 0,
      messageId: 'cmd-1',
      metadata: { type: 'command' },
    } as NormalizedLogEntry
    const output = {
      entryType: 'system-message',
      content: 'Context: 12k tokens',
      timestamp: '2026-01-01T00:00:01Z',
      turnIndex: 0,
      messageId: 'cmd-out-1',
      metadata: { subtype: 'command_output' },
    } as NormalizedLogEntry

    const { items } = rebuildAcpTimeline([command, output])
    // The output is consumed into the command item — not a second standalone entry.
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('command')
    expect((items[0] as { output?: { content: string } }).output?.content).toBe('Context: 12k tokens')
  })
})

describe('useAcpTimeline — thinking attachment edge cases', () => {
  it('flushes orphan thinking as standalone when no subsequent item', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Orphan thought',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
      },
    ]
    const { items } = rebuildAcpTimeline(logs)
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('thinking')
  })

  it('attaches thinking to tool-group when followed by tools', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me read the file',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
      },
      {
        entryType: 'tool-use',
        content: 'Read src/app.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        messageId: 't1',
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
    ]
    const { items } = rebuildAcpTimeline(logs)
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('tool-group')
    expect((items[0] as any).thinking).toBeDefined()
    expect((items[0] as any).thinking!.content).toBe('Let me read the file')
  })
})
