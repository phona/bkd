# PLAN-007 Engine rendering adapter layer

- **status**: implementing
- **createdAt**: 2026-05-10 07:00
- **approvedAt**: 2026-05-10 07:05
- **relatedTask**: ENG-003

## Context

BKD has a clean execution-side adapter layer for engines via
`EngineExecutor` and `BUILT_IN_PROFILES` in `apps/api/src/engines/types.ts`,
plus per-engine directories under `executors/` and an ACP sub-agent
registry (`executors/acp/agents/`).

`EngineCapability` covers engine features (`session-fork`, `setup-helper`,
`context-usage`, `plan-mode`, `sandbox`, `reasoning`) — i.e. what the
engine **can do**, not how the UI **should render** its output.

Frontend hardcoded engine checks audited:

| File | Check | Used for |
|---|---|---|
| `SessionMessages.tsx` | `engineType?.startsWith('acp')` | Pick AcpTimeline vs legacy renderer (structural) |
| `ChatInput.tsx` / `CreateIssueDialog.tsx` | `engineType === 'claude-code' \|\| 'claude-code-sdk'` | Lock model selection when omit-model enabled |
| `lib/assistant-preamble.ts` | hardcoded opencode header strings | Detect/split opencode preamble |
| `EngineIcons.tsx` | per-engine icon mapping | Visual identity (static, fine as-is) |

## Proposal

Add a `RenderingHint` type and plumb it through. Additive and backwards
compatible — no field renames, no component rewrites.

### 1. Shared types (`packages/shared/src/index.ts`)

```ts
export type RenderingHint =
  | 'task-plan-preamble'      // engine bundles structured task plan in assistant
  | 'inline-thinking'         // think→tool→think interleaving (Claude-style)
  | 'lock-model-when-omitted' // freeze model selection when omit-model enabled
```

Add `Issue.renderingHints?: RenderingHint[]`.

### 2. Backend declaration (`apps/api/src/engines/types.ts`)

```ts
export interface EngineExecutor {
  ...
  readonly renderingHints?: readonly RenderingHint[]
}
```

`AcpAgentDefinition` (`executors/acp/agents/base.ts`) gains the same
optional field; sub-agent hints **replace** the parent engine's hints.

### 3. Per-engine hint values

| Engine / sub-agent | Hints |
|---|---|
| `claude-code`, `claude-code-sdk` | `['inline-thinking', 'lock-model-when-omitted']` |
| `codex` | `[]` |
| `acp` (parent default) | `[]` |
| `acp:opencode` | `['task-plan-preamble']` |
| `acp:claude` | `['inline-thinking']` |
| `acp:gemini`, `acp:codex` | `[]` |

### 4. Issue projection

A small `resolveRenderingHints(engineType: string)` helper resolves the
final hint set from engineType (parses `acp:agent` form, queries the
ACP agent registry). Called wherever `Issue` is projected for the API
response.

### 5. Frontend gating

```ts
// LogEntry.tsx — pass renderingHints down through ChatBody → SessionMessages → AcpTimeline → LogEntry
const hasPreamble = renderingHints?.includes('task-plan-preamble') ?? false
const { preamble, reply } = hasPreamble
  ? splitAssistantPreamble(content)
  : { preamble: null, reply: content }

// ChatInput.tsx
const lockModelHint = renderingHints?.includes('lock-model-when-omitted') ?? false
const modelLocked = lockModelHint && (omitModelData?.enabled ?? false)
```

`SessionMessages.tsx`'s `startsWith('acp')` is intentionally NOT migrated.
It's selecting a rendering pipeline structure, not a behaviour flag.

### 6. Tests

Backend invariants:
- `resolveRenderingHints('acp:opencode')` includes `task-plan-preamble`
- `resolveRenderingHints('claude-code')` includes `inline-thinking` and
  `lock-model-when-omitted` but not `task-plan-preamble`
- `resolveRenderingHints('acp:gemini')` → empty
- `resolveRenderingHints('unknown')` → empty (graceful)

Frontend invariants:
- `LogEntry` with `hasPreamble=false` does NOT split content even when
  it contains the opencode header pattern
- `LogEntry` with `hasPreamble=true` splits as today

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Field added to Issue breaks clients | Low | Low | Optional field |
| Sub-agent hint override surprises | Low | Medium | Document: replace not merge |
| New engine forgets to declare | Medium | Low | Default empty = no special UI |
| Lock-model migration loses functionality | Low | Medium | Keep transitional fallback during rollout, drop after tests |

## Scope

| File | Change |
|---|---|
| `packages/shared/src/index.ts` | +`RenderingHint`, +`Issue.renderingHints` |
| `apps/api/src/engines/types.ts` | +`renderingHints` on `EngineExecutor`, declarations on `BUILT_IN_PROFILES` |
| `apps/api/src/engines/executors/acp/agents/base.ts` | +`renderingHints` field |
| `apps/api/src/engines/executors/acp/agents/{opencode,claude,gemini,codex}.ts` | declare hints |
| `apps/api/src/engines/render-hints.ts` | new resolver |
| `apps/api/src/engines/engine-store.ts` (or projection helper) | populate `Issue.renderingHints` |
| `apps/frontend/src/components/issue-detail/LogEntry.tsx` | gate split on hint |
| `apps/frontend/src/components/issue-detail/ChatInput.tsx` | gate model lock |
| `apps/frontend/src/components/kanban/CreateIssueDialog.tsx` | gate model lock |
| `apps/frontend/src/components/issue-detail/ChatBody.tsx` etc. | thread `renderingHints` prop down |
| `apps/api/src/engines/render-hints.test.ts` (new) | resolver invariants |
| `apps/frontend/src/__tests__/lib/assistant-preamble.test.ts` | hint-gated render test |

Net: ~150 lines, 0 deletions. Estimate 4-6 hours.

## Alternatives

- Extend `EngineCapability` instead of new `RenderingHint` type —
  rejected, mixes engine-feature and UI-rendering semantics.
- Server-driven UI hints (return JSON-described UI fragments) —
  rejected, overkill.
- Frontend-only registry — rejected, just moves the hardcoding.

## Annotations

- 2026-05-10 07:00: Drafted by Claude in response to user audit of
  engine-specific hardcoding in chat UI.
- 2026-05-10 07:05: User said `continue` after reviewing proposal.
  Status flipped to `implementing`.
