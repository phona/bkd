import type {
  NormalizedLogEntry,
  TaskPlanChatMessage,
  TimelineEntry,
  ToolGroupChatMessage,
  ToolGroupItem,
} from '@bkd/shared'
import { useRef } from 'react'

/**
 * Extract todo list from a TodoWrite tool entry or an ACP `plan` system entry.
 * Lives here (the single surviving chat hook) — was previously shared with the
 * now-deleted use-chat-messages.
 */
export function extractTodos(entry: NormalizedLogEntry): TaskPlanChatMessage['todos'] | null {
  const meta = entry.metadata
  if (!meta) return null
  const args = (meta.arguments ?? meta.input) as
    | {
      todos?: Array<{ content: string, status: string, activeForm?: string }>
    } |
    undefined
  if (args?.todos && Array.isArray(args.todos)) {
    return args.todos.map(t => ({
      content: t.content ?? '',
      status: t.status ?? 'pending',
      activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
    }))
  }

  const planEntries = meta.entries as
    | Array<{ content?: string, status?: string }>
    | undefined
  if (!planEntries || !Array.isArray(planEntries)) return null
  return planEntries.map(planEntry => ({
    content: planEntry.content ?? '',
    status: planEntry.status ?? 'pending',
  }))
}

export interface AcpTimelineEntryItem {
  type: 'entry'
  id: string
  entry: NormalizedLogEntry
  thinking?: NormalizedLogEntry // Attached preceding thinking
}

export interface AcpTimelineCommandItem {
  type: 'command'
  id: string
  /** The `/command` user-message entry */
  entry: NormalizedLogEntry
  /** The paired command_output system-message, if one followed */
  output?: NormalizedLogEntry
}

export interface AcpTimelinePlanItem {
  type: 'plan'
  id: string
  entry: NormalizedLogEntry
  todos: TaskPlanChatMessage['todos']
  completedCount: number
}

export interface AcpTimelineToolGroupItem {
  type: 'tool-group'
  id: string
  message: ToolGroupChatMessage
  thinking?: NormalizedLogEntry // Attached preceding thinking
}

export interface AcpTimelineThinkingItem {
  type: 'thinking'
  id: string
  entry: NormalizedLogEntry
  isStreaming: boolean
}

export type AcpTimelineItem =
  | AcpTimelineEntryItem
  | AcpTimelineCommandItem
  | AcpTimelinePlanItem
  | AcpTimelineToolGroupItem
  | AcpTimelineThinkingItem

export interface AcpTimelineResult {
  items: AcpTimelineItem[]
  pendingMessages: NormalizedLogEntry[]
}

/**
 * Noisy system subtypes that carry no user-facing value and — critically —
 * must NOT break an open tool cluster (PLAN-041 interleave). Legacy
 * (use-chat-messages) skipped exactly these; ported so the unified renderer
 * stays as quiet as the old claude-code path.
 */
const HIDDEN_SYSTEM_SUBTYPES = new Set([
  'thinking_tokens',
  'task_progress',
  'stop_hook_summary',
  'task_notification',
])

function isHiddenEntry(entry: TimelineEntry): boolean {
  if (entry.entryType === 'loading' || entry.entryType === 'token-usage') return true
  if (entry.entryType === 'user-message' && entry.metadata?.type === 'system') return true
  if (
    entry.entryType === 'system-message'
    && HIDDEN_SYSTEM_SUBTYPES.has(entry.metadata?.subtype as string)
  ) {
    return true
  }
  return false
}

export const SKILL_PATH_PATTERNS = ['.agents/skills/', '.claude/skills/', 'superpowers']

function isSkillTool(entry: TimelineEntry): boolean {
  if (entry.type !== 'tool') return false
  return isSkillEntry(entry)
}

export function isSkillEntry(entry: { metadata?: Record<string, unknown> | null, toolDetail?: { toolName?: string, raw?: Record<string, unknown> } | null }): boolean {
  const locations = (entry.metadata?.locations ?? entry.toolDetail?.raw?.locations) as Array<{ path?: string }> | undefined
  const firstPath = locations?.[0]?.path
  if (firstPath && SKILL_PATH_PATTERNS.some(p => firstPath.includes(p))) return true
  const toolName = entry.toolDetail?.toolName
  if (toolName && SKILL_PATH_PATTERNS.some(p => toolName.includes(p))) return true
  return false
}

/**
 * Map heterogeneous engine kind names to the canonical ToolAction.kind union.
 *
 * Engine-side conventions are inconsistent: ACP/opencode stores
 * `metadata.kind = "execute" | "read" | "edit"` while the typed
 * ToolAction.kind union uses "command-run" | "file-read" | "file-edit".
 * Without normalization, every tool falls through to "other" in stats
 * (root cause 9: "5 other" labels for groups containing only known tools).
 */
function normalizeKind(raw: string | undefined): string {
  if (!raw) return 'other'
  switch (raw) {
    case 'read':
    case 'file-read': return 'file-read'
    case 'edit':
    case 'write':
    case 'file-edit': return 'file-edit'
    case 'execute':
    case 'bash':
    case 'command-run': return 'command-run'
    case 'search':
    case 'grep':
    case 'glob': return 'search'
    case 'fetch':
    case 'web-fetch': return 'web-fetch'
    case 'agent': return 'agent'
    case 'task-plan': return 'task-plan'
    case 'user-question': return 'user-question'
    default: return 'other'
  }
}

function pickKind(item: ToolGroupItem): string {
  const md = item.action.metadata as Record<string, unknown> | undefined
  return normalizeKind(
    item.action.toolDetail?.kind
    ?? item.action.toolAction?.kind
    ?? (typeof md?.kind === 'string' ? (md.kind as string) : undefined),
  )
}

function buildToolGroup(items: ToolGroupItem[]): ToolGroupChatMessage {
  const stats: Record<string, number> = {}
  for (const item of items) {
    const kind = pickKind(item)
    stats[kind] = (stats[kind] ?? 0) + 1
  }
  // Stable group id derived from the first action's id (or messageId).
  // Crucially NOT Date.now() — that fallback drifted between calls inside
  // the same useMemo, causing React keys to change on every chunk and the
  // entire group to unmount/remount (root cause 6).
  const first = items[0]?.action
  const stableId = first?.messageId
    ?? (first as TimelineEntry | undefined)?.id
    ?? first?.toolDetail?.toolCallId
    ?? `tg-${items.length}`
  return {
    type: 'tool-group',
    id: `acp-tg-${stableId}`,
    items,
    stats,
    count: items.length,
    hiddenCount: 0,
  }
}

interface BuilderState {
  items: AcpTimelineItem[]
  pendingMessages: NormalizedLogEntry[]
  pendingThinking: TimelineEntry | null
  toolBuffer: ToolGroupItem[]
}

interface BuilderSnapshot {
  pendingThinking: TimelineEntry | null
  toolBuffer: ToolGroupItem[]
  pendingMessages: NormalizedLogEntry[]
  itemsLength: number
}

function flushToolBuffer(state: BuilderState): void {
  if (state.toolBuffer.length === 0) return
  const toolGroupThinking = state.pendingThinking ?? undefined
  if (toolGroupThinking) state.pendingThinking = null
  const group = buildToolGroup(state.toolBuffer)
  state.items.push({ type: 'tool-group', id: group.id, message: group, thinking: toolGroupThinking })
  state.toolBuffer = []
}

function flushPendingThinking(state: BuilderState): void {
  if (!state.pendingThinking) return
  state.items.push({
    type: 'thinking',
    id: state.pendingThinking.id,
    entry: state.pendingThinking,
    isStreaming: state.pendingThinking.metadata?.streaming === true,
  })
  state.pendingThinking = null
}

/**
 * When reasoning arrives after the assistant response (common with OpenCode/ACP),
 * the backend converter gives the thinking segment a later sequence, so it sorts
 * after the assistant message and renders below the reply. The system may also
 * emit process-exit/system messages between the reply and the late reasoning, in
 * which case `processEntry` attaches the pending thinking to that system entry.
 * Reassign any trailing/orphaned thinking back to the most recent assistant entry
 * in the same turn so it renders above the response where users expect it.
 */
function reassignTrailingThinking(items: AcpTimelineItem[]): AcpTimelineItem[] {
  const result: AcpTimelineItem[] = []
  for (const item of items) {
    let orphanThinking: NormalizedLogEntry | undefined

    if (item.type === 'thinking') {
      orphanThinking = item.entry
    }
    else if (
      item.type === 'entry'
      && item.thinking
      && item.entry.entryType !== 'assistant-message'
    ) {
      // Thinking that got attached to a system/error/user entry by processEntry
      // should live on the assistant response instead.
      orphanThinking = item.thinking
      item.thinking = undefined
    }

    if (item.type !== 'thinking') {
      result.push(item)
    }

    if (orphanThinking) {
      let attached = false
      for (let i = result.length - 1; i >= 0; i--) {
        const candidate = result[i]!
        if (
          candidate.type === 'entry'
          && candidate.entry.entryType === 'assistant-message'
          && candidate.entry.turnIndex === orphanThinking.turnIndex
          && !candidate.thinking
        ) {
          candidate.thinking = orphanThinking
          attached = true
          break
        }
        // Stop searching once we cross a user turn boundary.
        if (
          candidate.type === 'entry'
          && candidate.entry.entryType === 'user-message'
        ) {
          break
        }
      }
      if (!attached) {
        result.push({
          type: 'thinking',
          id: orphanThinking.id,
          entry: orphanThinking,
          isStreaming: orphanThinking.metadata?.streaming === true,
        })
      }
    }
  }
  return result
}

function processEntry(
  entry: TimelineEntry,
  state: BuilderState,
  resultMap: Map<string, TimelineEntry>,
  commandOutputById: Map<string, TimelineEntry>,
  consumedOutputIds: Set<string>,
): void {
  if (isHiddenEntry(entry)) return

  // Skip command_output system-messages already folded into a command item.
  if (consumedOutputIds.has(entry.id)) return

  if (entry.entryType === 'user-message' && (entry.metadata?.type === 'pending' || entry.metadata?.type === 'done')) {
    state.pendingMessages.push(entry)
    return
  }

  // `/command` user-messages render as a collapsed <details> with their
  // paired output (ported from Legacy). A command is a real segment
  // boundary, so close any open tool cluster / thinking first.
  if (entry.entryType === 'user-message' && entry.metadata?.type === 'command') {
    flushToolBuffer(state)
    flushPendingThinking(state)
    state.items.push({
      type: 'command',
      id: entry.id,
      entry,
      output: commandOutputById.get(entry.id),
    })
    return
  }

  if (entry.type === 'thinking') {
    flushToolBuffer(state)
    // Skip empty thinking chunks (Claude/ACP adapter sometimes emits
    // agent_thought_chunk with no content). Backend filter is the
    // primary guard; this is a safety net for edge cases.
    if (entry.content.trim().length > 0) {
      state.pendingThinking = entry
    }
    return
  }

  if (entry.type === 'tool') {
    if (entry.metadata?.isResult) {
      return
    }
    if (isSkillTool(entry)) return
    const callId = entry.metadata?.toolCallId as string | undefined
    const result = callId ? resultMap.get(callId) ?? null : null
    state.toolBuffer.push({ action: entry, result })
    // Don't flush yet — adjacent tools accumulate into one group so a
    // burst of N actions renders as one card with N items. Streaming
    // still feels real-time because rebuild runs on every log change
    // and the end-of-loop flushToolBuffer() emits the in-flight group
    // on every render.
    return
  }

  if (entry.entryType === 'system-message' && entry.metadata?.subtype === 'plan') {
    const todos = extractTodos(entry)
    if (todos) {
      flushToolBuffer(state)
      state.items.push({
        type: 'plan',
        id: entry.id,
        entry,
        todos,
        completedCount: todos.filter(todo => todo.status === 'completed').length,
      })
      return
    }
  }

  flushToolBuffer(state)

  // Note: previously we deleted a preceding thinking block when the
  // assistant content started with the same text, on the assumption that
  // the assistant was just a richer repeat of the thinking. That heuristic
  // fires constantly because models commonly open the reply with the same
  // sentence as the reasoning ("让我看看 X" → "让我看看 X，发现..."),
  // so the whole thinking block silently vanished. Thinking is its own
  // surface — keep it; if the duplication bothers users, they can collapse
  // the thinking <details> block.

  const attachedThinking = state.pendingThinking ?? undefined
  state.pendingThinking = null
  state.items.push({ type: 'entry', id: entry.id, entry, thinking: attachedThinking })
}

function buildMaps(entries: TimelineEntry[]) {
  // Pre-pass: collect tool results by callId so actions can pair with results
  // regardless of arrival order.
  const resultMap = new Map<string, TimelineEntry>()
  for (const entry of entries) {
    if (entry.type === 'tool' && entry.metadata?.isResult) {
      const callId = entry.metadata?.toolCallId as string | undefined
      if (callId) resultMap.set(callId, entry)
    }
  }

  // Pre-pass: pair each `/command` user-message with the next command_output
  // system-message so the command renders as one expandable <details> (ported
  // from Legacy). The matched outputs are consumed so they don't also render
  // standalone.
  const commandOutputById = new Map<string, TimelineEntry>()
  const consumedOutputIds = new Set<string>()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (e.entryType === 'user-message' && e.metadata?.type === 'command') {
      for (let j = i + 1; j < entries.length; j++) {
        const c = entries[j]!
        if (
          c.entryType === 'system-message'
          && c.metadata?.subtype === 'command_output'
          && !consumedOutputIds.has(c.id)
        ) {
          commandOutputById.set(e.id, c)
          consumedOutputIds.add(c.id)
          break
        }
      }
    }
  }

  return { resultMap, commandOutputById, consumedOutputIds }
}

/**
 * Pure mapping from backend-normalized TimelineEntry[] → AcpTimelineItem[].
 *
 * Backend's TimelineConverter already guarantees:
 *   - segment splitting (multi-thinking / multi-assistant per turn)
 *   - chunk merging (cumulative + delta)
 *   - deduplication, ordering (via sequence), noise filtering
 *
 * This layer only does what the backend can't:
 *   - Tool action ↔ result pairing for the ToolGroupMessage UI
 *   - Plan extraction from system-message subtype=plan
 *   - Pending message segregation
 *   - Adjacent tools collapsed into a single visual group
 *
 * No more thinking dedup heuristics — the converter splits segments into
 * distinct entries with distinct ids. No more chunk merging — content is
 * already accumulated upstream.
 */
function buildTimeline(entries: TimelineEntry[]): { result: AcpTimelineResult, snapshots: BuilderSnapshot[] } {
  const { resultMap, commandOutputById, consumedOutputIds } = buildMaps(entries)
  const state: BuilderState = {
    items: [],
    pendingMessages: [],
    pendingThinking: null,
    toolBuffer: [],
  }
  const snapshots: BuilderSnapshot[] = []

  for (const entry of entries) {
    processEntry(entry, state, resultMap, commandOutputById, consumedOutputIds)
    snapshots.push({
      pendingThinking: state.pendingThinking,
      toolBuffer: [...state.toolBuffer],
      pendingMessages: [...state.pendingMessages],
      itemsLength: state.items.length,
    })
  }

  flushToolBuffer(state)
  flushPendingThinking(state)

  const foldedItems = reassignTrailingThinking(state.items)

  return {
    result: { items: foldedItems, pendingMessages: state.pendingMessages },
    snapshots,
  }
}

export function rebuildAcpTimeline(entries: TimelineEntry[]): AcpTimelineResult {
  return buildTimeline(entries).result
}

/**
 * Try to patch only the changed tail of `nextLogs` against the previously
 * built `prevResult`/`prevSnapshots`. Returns `null` when the change is not
 * a simple tail append/replace (e.g. older-log prepend, result arriving for
 * an action in the prefix, etc.) and the caller must fall back to a full
 * rebuild.
 */
function patchTimeline(
  prevLogs: TimelineEntry[],
  nextLogs: TimelineEntry[],
  prevResult: AcpTimelineResult,
  prevSnapshots: BuilderSnapshot[],
): { result: AcpTimelineResult, snapshots: BuilderSnapshot[] } | null {
  let firstDiff = -1
  const limit = Math.min(prevLogs.length, nextLogs.length)
  for (let i = 0; i < limit; i++) {
    if (prevLogs[i] !== nextLogs[i]) {
      firstDiff = i
      break
    }
  }
  if (firstDiff === -1) {
    if (nextLogs.length === prevLogs.length) {
      return { result: prevResult, snapshots: prevSnapshots }
    }
    firstDiff = prevLogs.length
  }

  // Older logs prepended at the top — not a tail patch.
  if (firstDiff === 0 && nextLogs.length > prevLogs.length) {
    return null
  }

  // If a result in the suffix pairs with an action before the changed window,
  // the prefix tool-group would need updating. Fall back to full rebuild.
  for (let i = firstDiff; i < nextLogs.length; i++) {
    const e = nextLogs[i]!
    if (e.type === 'tool' && e.metadata?.isResult) {
      const callId = e.metadata?.toolCallId as string | undefined
      if (!callId) continue
      const actionBefore = nextLogs.findIndex((x, idx) =>
        idx < firstDiff
        && x.type === 'tool'
        && !x.metadata?.isResult
        && (x.metadata?.toolCallId as string | undefined) === callId,
      )
      if (actionBefore >= 0) return null
    }
  }

  // If a command/output pair crosses the boundary, fall back.
  let commandOutputInSuffix = false
  for (let i = firstDiff; i < nextLogs.length; i++) {
    const e = nextLogs[i]!
    if (e.entryType === 'system-message' && e.metadata?.subtype === 'command_output') {
      commandOutputInSuffix = true
      break
    }
  }
  if (commandOutputInSuffix) {
    for (let i = 0; i < firstDiff; i++) {
      const e = nextLogs[i]!
      if (e.entryType === 'user-message' && e.metadata?.type === 'command') {
        return null
      }
    }
  }

  // Build maps for the suffix only — the prefix has already been processed.
  const resultMap = new Map<string, TimelineEntry>()
  for (let i = firstDiff; i < nextLogs.length; i++) {
    const e = nextLogs[i]!
    if (e.type === 'tool' && e.metadata?.isResult) {
      const callId = e.metadata?.toolCallId as string | undefined
      if (callId) resultMap.set(callId, e)
    }
  }
  const commandOutputById = new Map<string, TimelineEntry>()
  const consumedOutputIds = new Set<string>()
  for (let i = firstDiff; i < nextLogs.length; i++) {
    const e = nextLogs[i]!
    if (e.entryType === 'user-message' && e.metadata?.type === 'command') {
      for (let j = i + 1; j < nextLogs.length; j++) {
        const c = nextLogs[j]!
        if (
          c.entryType === 'system-message'
          && c.metadata?.subtype === 'command_output'
          && !consumedOutputIds.has(c.id)
        ) {
          commandOutputById.set(e.id, c)
          consumedOutputIds.add(c.id)
          break
        }
      }
    }
  }

  const state: BuilderState = firstDiff === 0
    ? { items: [], pendingMessages: [], pendingThinking: null, toolBuffer: [] }
    : {
        items: [],
        pendingMessages: [...prevSnapshots[firstDiff - 1]!.pendingMessages],
        pendingThinking: prevSnapshots[firstDiff - 1]!.pendingThinking,
        toolBuffer: [...prevSnapshots[firstDiff - 1]!.toolBuffer],
      }

  const suffixSnapshots: BuilderSnapshot[] = []
  for (let i = firstDiff; i < nextLogs.length; i++) {
    processEntry(nextLogs[i]!, state, resultMap, commandOutputById, consumedOutputIds)
    suffixSnapshots.push({
      pendingThinking: state.pendingThinking,
      toolBuffer: [...state.toolBuffer],
      pendingMessages: [...state.pendingMessages],
      itemsLength: state.items.length,
    })
  }
  flushToolBuffer(state)
  flushPendingThinking(state)

  const foldedItems = reassignTrailingThinking(state.items)

  const prefixItemsLength = firstDiff === 0 ? 0 : prevSnapshots[firstDiff - 1]!.itemsLength
  const prefixPendingMessages = firstDiff === 0 ? [] : prevSnapshots[firstDiff - 1]!.pendingMessages
  const result: AcpTimelineResult = {
    items: prevResult.items.slice(0, prefixItemsLength).concat(foldedItems),
    pendingMessages: prefixPendingMessages.concat(state.pendingMessages),
  }
  const snapshots = firstDiff === 0
    ? suffixSnapshots
    : prevSnapshots.slice(0, firstDiff).concat(suffixSnapshots)

  return { result, snapshots }
}

export function useAcpTimeline(logs: TimelineEntry[]): AcpTimelineResult {
  const cacheRef = useRef<{
    logs: TimelineEntry[]
    result: AcpTimelineResult
    snapshots: BuilderSnapshot[]
  } | null>(null)

  const prev = cacheRef.current
  if (!prev || logs.length < prev.logs.length) {
    const built = buildTimeline(logs)
    cacheRef.current = { logs, result: built.result, snapshots: built.snapshots }
    return built.result
  }

  const patched = patchTimeline(prev.logs, logs, prev.result, prev.snapshots)
  if (!patched) {
    const built = buildTimeline(logs)
    cacheRef.current = { logs, result: built.result, snapshots: built.snapshots }
    return built.result
  }

  cacheRef.current = { logs, result: patched.result, snapshots: patched.snapshots }
  return patched.result
}
