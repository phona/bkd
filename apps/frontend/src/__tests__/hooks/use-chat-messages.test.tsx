import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NormalizedLogEntry } from '@/types/kanban'
import { useChatMessages } from '@/hooks/use-chat-messages'
import issueLogsFixture from './__fixtures__/issue-8d0nfwa6-logs.json'

describe('useChatMessages — real issue 8d0nfwa6 turn 3 (refresh-loss repro)', () => {
  // User report: "为啥工具调用直接没有思考过程或者ai回复？" + "本来有的。刷新回来后就没了".
  // This fixture is the actual /api/.../logs response for that exact issue, turn
  // 3 of which is THIS conversation. DB has 3 assistant-message entries
  // (turn-3-assistant-0000/0001/0002) interleaved with tool-use action+result
  // pairs. The user said the assistant replies disappear after refresh.
  // This test renders useChatMessages on the real entries and asserts what
  // the user expects to see: 1 user message, 3 assistant messages, plus tool
  // groups in between.
  it('preserves all 3 assistant-messages in turn 3 (the messages the user says disappear)', () => {
    const all = (issueLogsFixture as {
      data: { logs: NormalizedLogEntry[] }
    }).data.logs
    const turn3 = all.filter(l => l.turnIndex === 3)

    const { result } = renderHook(() => useChatMessages(turn3))
    const types = result.current.messages.map(m => m.type)

    // DB ground truth for turn 3:
    //   1 user-message
    //   3 assistant-message (turn-3-assistant-0000, 0001, 0002)
    //   tool-groups in between
    const assistantCount = types.filter(t => t === 'assistant').length
    const userCount = types.filter(t => t === 'user').length

    expect(userCount).toBe(1)
    expect(assistantCount).toBe(3)
  })

  // The user's actual complaint: "工具调用没信息了，都不知道为什么有这个工具调用".
  // Hypothesis: commit 806eb46 changed flushToolBuffer to fire after EVERY
  // tool action so they appear in real-time during streaming. Side effect —
  // turn 3 has 12+ tool actions but ZERO get visually grouped, producing
  // 12+ standalone single-item tool cards with no preceding assistant text
  // explaining each one. The one assistant-message at the top of the turn
  // serves all 12 tools at once, so tools 2-12 look orphaned.
  it('groups adjacent tools into a single tool-group (currently produces one card per tool)', () => {
    const all = (issueLogsFixture as {
      data: { logs: NormalizedLogEntry[] }
    }).data.logs
    const turn3 = all.filter(l => l.turnIndex === 3)

    const { result } = renderHook(() => useChatMessages(turn3))
    const types = result.current.messages.map(m => m.type)
    const toolGroupCount = types.filter(t => t === 'tool-group').length

    // DB turn 3: 14 tool actions (28 tool-use entries / 2 for action+result pairs)
    // arranged in roughly 3 contiguous bursts separated by assistant messages.
    //   user → assistant-0000 → [12 tool actions] → assistant-0001
    //        → [5 tool actions] → assistant-0002
    // Visually grouped → expect 3 tool-groups (one per burst).
    // ACTUAL (after 806eb46): one group per action → ~14 groups.
    expect(toolGroupCount).toBeLessThanOrEqual(3)
  })

  // Cross-check the full issue (not just turn 3). DB has 6 assistant-message
  // entries across 5 turns and 5 user-message entries. If useChatMessages
  // drops anything globally (e.g. system-message filtering, pending bucket
  // siphoning, or commandOutputByIdx absorbing a real entry), the counts
  // here will diverge from DB ground truth and pinpoint the offender.
  it('preserves all 6 assistant + 5 user messages across the whole issue', () => {
    const all = (issueLogsFixture as {
      data: { logs: NormalizedLogEntry[] }
    }).data.logs

    const { result } = renderHook(() => useChatMessages(all))
    const { messages, pendingMessages } = result.current

    const dbAssistant = all.filter(l => l.entryType === 'assistant-message').length
    const dbUser = all.filter(l => l.entryType === 'user-message').length
    const renderedAssistant = messages.filter(m => m.type === 'assistant').length
    const renderedUser = messages.filter(m => m.type === 'user').length + pendingMessages.length

    expect({ user: renderedUser, assistant: renderedAssistant })
      .toEqual({ user: dbUser, assistant: dbAssistant })
  })
})

describe('useChatMessages — thinking + tool-group rendering', () => {
  // Regression guard for the thinking-as-description bug: long thinking text
  // used to be folded into the tool group's `description` field and rendered
  // by ToolItems.tsx:919 as a single `<span className="truncate">` line in
  // the header — visually equivalent to "thinking disappeared after refresh".
  // Now thinking always flushes as its own ThinkingChatMessage before the
  // tool group.
  it('keeps thinking as standalone message when followed by tool group', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '让我看看这个 SQL 查询的 JOIN 条件',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
      },
      {
        entryType: 'tool-use',
        content: 'Read db/schema.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        messageId: 't1',
        metadata: { toolCallId: 't1', isResult: false, toolName: 'Read' },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: '问题出在 JOIN 条件上：left join 应该改成 inner join',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
      },
    ]

    const { result } = renderHook(() => useChatMessages(logs))
    const types = result.current.messages.map(m => m.type)
    expect(types).toEqual(['thinking', 'tool-group', 'assistant'])
  })
})

describe('useChatMessages — PLAN-041 interleaved tool/text timeline', () => {
  function asst(text: string, seq: number): NormalizedLogEntry {
    return {
      entryType: 'assistant-message',
      content: text,
      timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
      turnIndex: 0,
      messageId: `am-${text}`,
      sequence: seq,
    } as NormalizedLogEntry
  }
  function tool(id: string, seq: number): NormalizedLogEntry {
    return {
      entryType: 'tool-use',
      content: `Read ${id}`,
      timestamp: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
      turnIndex: 0,
      messageId: id,
      sequence: seq,
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
      sequence: seq,
    } as NormalizedLogEntry
  }

  // The core interleave case from PLAN-041: a turn shaped as
  // text → tool → text → tool → text (monotonic sequence) must render with
  // tool cards BETWEEN the assistant segments they fall between — NOT all the
  // text merged into one bubble with the tools yanked into a trailing group.
  it('interleaves tools between assistant text segments by sequence', () => {
    const logs: NormalizedLogEntry[] = [
      asst('a', 0),
      tool('t1', 1),
      asst('b', 2),
      tool('t2', 3),
      asst('c', 4),
    ]
    const { result } = renderHook(() => useChatMessages(logs))
    const msgs = result.current.messages

    expect(msgs.map(m => m.type)).toEqual([
      'assistant',
      'tool-group',
      'assistant',
      'tool-group',
      'assistant',
    ])
    // The three assistant segments stay separate (no cross-tool text merge).
    expect(msgs.filter(m => m.type === 'assistant').map(m => (m as { entry: { content?: string } }).entry.content))
      .toEqual(['a', 'b', 'c'])
    // Each tool-group holds exactly the single tool that falls in that slot.
    const groups = msgs.filter(m => m.type === 'tool-group') as Array<{ count: number }>
    expect(groups.map(g => g.count)).toEqual([1, 1])
  })

  // Genuinely adjacent tools (no intervening non-tool entry) must still
  // cluster into ONE card — don't explode into one card per parallel call.
  it('clusters genuinely adjacent tools into a single tool-group', () => {
    const logs: NormalizedLogEntry[] = [
      asst('a', 0),
      tool('t1', 1),
      tool('t2', 2),
      asst('b', 3),
    ]
    const { result } = renderHook(() => useChatMessages(logs))
    const msgs = result.current.messages

    expect(msgs.map(m => m.type)).toEqual(['assistant', 'tool-group', 'assistant'])
    expect((msgs[1] as { count: number }).count).toBe(2)
  })

  // A thinking entry between two tool bursts is a real boundary: the two
  // bursts must NOT merge across it, and order must follow sequence.
  it('does not merge tools across an intervening thinking entry', () => {
    const logs: NormalizedLogEntry[] = [tool('t1', 1), think(2), tool('t2', 3)]
    const { result } = renderHook(() => useChatMessages(logs))
    expect(result.current.messages.map(m => m.type)).toEqual([
      'tool-group',
      'thinking',
      'tool-group',
    ])
  })

  // Thinking that PRECEDES a burst still describes it (renders above the
  // group) — the original PLAN-009 UX must not regress.
  it('keeps thinking-before-burst rendering above the group', () => {
    const logs: NormalizedLogEntry[] = [think(1), tool('t1', 2), tool('t2', 3)]
    const { result } = renderHook(() => useChatMessages(logs))
    expect(result.current.messages.map(m => m.type)).toEqual(['thinking', 'tool-group'])
  })
})

describe('useChatMessages — stable ids across prepend (virtual-scroll overlap guard)', () => {
  // Load-bearing invariant for the VirtualMessageList fix: react-virtual keys
  // its measured-row-height cache by `getItemKey(index)` — which we set to
  // `msg.id`. That only prevents overlapping rows if a given message keeps the
  // SAME id before and after older history is prepended (scroll-up load). If
  // ids ever became positional, prepend would shift them, the height cache
  // would re-attach to the wrong rows, and bubbles would stack on the same
  // line (the reported bug). This locks the contract `getItemKey` depends on.
  //
  // jsdom has no layout engine, so the visual overlap itself is not unit
  // testable; this guards the underlying cause instead.
  const all = (issueLogsFixture as {
    data: { logs: NormalizedLogEntry[] }
  }).data.logs
  // Split the real conversation at a turn boundary: "recent" is the window
  // first shown; "older" is what a scroll-up load prepends in front of it.
  const recent = all.filter(l => (l.turnIndex ?? 0) >= 3)
  const older = all.filter(l => (l.turnIndex ?? 0) < 3)

  it('keeps every recent message id identical after older logs are prepended', () => {
    const { result: before } = renderHook(() => useChatMessages(recent))
    const { result: after } = renderHook(() => useChatMessages([...older, ...recent]))

    const idsBefore = before.current.messages.map(m => m.id)
    const idsAfter = new Set(after.current.messages.map(m => m.id))

    expect(idsBefore.length).toBeGreaterThan(0)
    // Each id present pre-prepend must still exist post-prepend, unchanged.
    for (const id of idsBefore) {
      expect(idsAfter.has(id)).toBe(true)
    }
  })

  it('produces unique message ids (no duplicate react/virtual keys)', () => {
    const { result } = renderHook(() => useChatMessages([...older, ...recent]))
    const ids = result.current.messages.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('useChatMessages', () => {
  it('maps ACP plan system messages into task-plan messages', () => {
    const logs: NormalizedLogEntry[] = [{
      entryType: 'system-message',
      content: 'pending: Inspect repo\nin_progress: Implement ACP',
      timestamp: '2026-03-13T00:00:00.000Z',
      metadata: {
        subtype: 'plan',
        entries: [
          { content: 'Inspect repo', status: 'pending' },
          { content: 'Implement ACP', status: 'in_progress' },
        ],
      },
    }]

    const { result } = renderHook(() => useChatMessages(logs))

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toMatchObject({
      type: 'task-plan',
      completedCount: 0,
      todos: [
        { content: 'Inspect repo', status: 'pending' },
        { content: 'Implement ACP', status: 'in_progress' },
      ],
    })
  })
})
