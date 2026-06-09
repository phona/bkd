# PLAN-042 Built-in coding agent (Vercel AI SDK) as a bkd ACP agent — `acp:bkd-agent`

- **status**: draft (pending `proceed`)
- **createdAt**: 2026-06-08
- **approvedAt**: (pending)
- **relatedTask**: AGENT-001
- **borrowed-from**: AoE `acp-worker/aoe-agent` (Vercel AI SDK agent speaking ACP)

## Motivation (user)

"想做 [一个 Vercel AI SDK 引擎]，bkd 的 chat 太多 bug 了。" The CLI-driven engines (claude-code stream-json) need a fragile normalization layer (source of much of the chat-ordering/streaming bug history: PLAN-007/009/010/034/041). A built-in agent on the **Vercel AI SDK** emits a clean, ordered `fullStream` (text-delta / tool-call / tool-result interleaved) → reliable streaming + interleave with almost no normalization. Also: BYO API key, multi-provider (Anthropic/OpenAI/Google/openai-compatible) — fits bkd's "your creds, no lock-in" charter.

**Honest scope note:** this does NOT fix the *frontend* chat bugs (scroll/switching — those are shared and addressed by PLAN-040/041). It removes the *engine/normalization* bug class for this engine and gives native streaming. It also means **we now own a coding agent** (tools, system prompt, edit reliability) that must compete with Claude Code's polish — a real maintenance surface. Worth choosing consciously.

## Investigation findings

### AoE's `aoe-agent` (the reference) — `acp-worker/aoe-agent/src/index.ts`
- Stateless Node process, ACP over stdio (`acp.ndJsonStream` + `AgentSideConnection`). Implements `initialize`/`newSession`/`loadSession`/`prompt`/`cancel`.
- `prompt()`: append user msg → `streamText({ model, messages, tools, stopWhen: stepCountIs(16), abortSignal })` → iterate `result.fullStream` → emit ACP `sessionUpdate` notifications: `agent_message_chunk` (text-delta), `tool_call` (pending), `tool_call_update` (completed/failed). Accumulate assistant text → push to `messages`.
- Tools: Read / Write / Bash (zod schemas); aoe-agent delegates fs/shell to the ACP CLIENT via `readTextFile`/`writeTextFile`/`createTerminal` RPC (aoe owns disk). Model: prefix routing (`claude-*`→anthropic, `gpt-*`→openai, `gemini-*`→google), key from env. **No system prompt** (aoe injects context). History in-memory only (aoe persists).

### bkd ACP integration (what we get free) — `engines/executors/acp/`
- `acp:<agent>:<model>` parsed by `agents/base.ts parseAcpModelWithRegistry`; agent registry in `agents/index.ts` (gemini/codex/claude/opencode). `executors/index.ts` routes any `acp:*` to the single `AcpExecutor`.
- `executor.ts` spawns the agent, does the ACP handshake (`protocol-handler.ts`: initialize → newSession/loadSession → setSessionMode/Model → prompt), reuses the process per `externalSessionId` for follow-ups, cancel → connection.cancel + SIGTERM/KILL.
- `normalizer.ts` already maps `agent_message_chunk`→streaming assistant, `agent_thought_chunk`→streaming thinking, `tool_call`→tool-use, `tool_call_update`→tool result, with mergeStreamingParts + dbOnly flush (handles cumulative AND delta agents). **Streaming + interleave for free.**
- `safe-env.ts` allowlists `ANTHROPIC_API_KEY/OPENAI_API_KEY/GOOGLE_API_KEY/GEMINI_API_KEY/CODEX_API_KEY` for `acp` spawns; `engine:globalEnvVars` DB setting injects user keys. Models surface via the agent's `newSession().models` → scoped `acp:bkd-agent:<modelId>` in the create dialog.
- bkd stores only `externalSessionId` + display logs; **the ACP agent owns conversation history** (loadSession must restore it).

## Proposal

Build **`@bkd/agent`** — a standalone Bun/TS ACP coding-agent on the Vercel AI SDK — and register it as the `bkd-agent` ACP agent. No new executor; 3-line registry change.

### The agent process (`packages/agent/` or `apps/agent/`)
- Deps: `ai`@6, `@ai-sdk/anthropic|openai|google|openai-compatible`, `@agentclientprotocol/sdk` (the same ACP SDK bkd's client uses), `zod`.
- ACP server: `initialize` (agentInfo), `newSession` (advertise models + return sessionId), `loadSession` (restore history by sessionId), `prompt` (streamText loop → sessionUpdate notifications), `cancel` (AbortController).
- `prompt` loop mirrors aoe-agent: `streamText({ model, system, messages, tools, stopWhen: stepCountIs(N), abortSignal })`, iterate `fullStream`, emit `agent_message_chunk`/`tool_call`/`tool_call_update`/`agent_thought_chunk` (reasoning), append assistant to history, persist.
- **Tools run LOCALLY** (agent runs on the bkd host; cwd = the issue's worktree passed via newSession `cwd`): Read, Write, Edit (string-replace), Bash, Grep, Glob, Ls. (aoe-agent delegated to the client; we do fs/child_process directly — simpler, no client-side tool RPC to implement.)
- **History persistence**: ModelMessage[] per sessionId on disk (JSONL or a small SQLite under the bkd data dir), so loadSession restores after a process restart. (aoe-agent kept it in-memory and lost it; we want durable resume like Claude Code's .jsonl.)
- **System prompt**: a real coding-agent prompt (tool usage, edit discipline, repo conventions) — aoe-agent had none; we need one.
- **Model routing**: `acp:bkd-agent:<modelId>` → provider by prefix/config; keys from env (bkd-injected).
- **Tool execution = auto** for MVP (run immediately); permission/ask-mode is a later phase.

### bkd registration (3 edits)
- `engines/executors/acp/agents/bkd-agent.ts` — `AcpAgentDefinition` (id `bkd-agent`, commandName + npxFallback/bun path, authStatus from ANTHROPIC_API_KEY, verify).
- `agents/base.ts` — add `'bkd-agent'` to `AcpAgentId` union.
- `agents/index.ts` — register in `ACP_AGENTS`.

### Packaging / spawn
- The agent must be spawnable by the deployed bkd (which ships as a package/binary). Decide: bundle `@bkd/agent` into a script under the app dir and point `npxFallback`/commandName at it (`bun <appdir>/agent.js`), OR compile a small binary, OR publish to npm + npx. Must work in the `/workspace` package-mode deploy. (This is the main non-obvious build chore.)

## Decisions needed (please pick)
1. **MVP providers**: Anthropic only first, or Anthropic + OpenAI + Google + openai-compatible from day 1? (more = trivial extra, but key/model config UI grows.)
2. **MVP tool set**: minimal (Read/Write/Edit/Bash/Grep/Glob/Ls) — confirm, or want more (apply-patch/multi-edit/todo) in P1?
3. **History store**: JSONL-per-session (simple, greppable, Claude-Code-like) vs SQLite — preference?
4. **Tool approval**: auto-run in MVP (defer ask-mode), or wire bkd's permission mode now?
5. **Packaging**: bundle into app dir (recommended for the self-host deploy) vs npm-publish.

## Phasing
- **P1 MVP** — agent process (ACP server + streamText loop + minimal tools + JSONL history + system prompt + Anthropic) + 3-line registration + packaging into the deploy. End-to-end: select `acp:bkd-agent:claude-…` in the create dialog → native streaming + interleaved tools, follow-ups resume.
- **P2** — more providers + model/key config surface; richer tools (multi-edit/apply-patch, todo, optional web); permission/ask-mode integration; MCP passthrough.
- **P3** — polish: token/cost surfacing, mid-turn cancel correctness, sub-agents, prompt/tool quality iteration.

## Risks
- **We own agent quality**: tool design, system prompt, edit reliability now ours (Claude Code is very polished — set expectations; iterate).
- **History/resume correctness**: durable ModelMessage[] persistence + loadSession must be solid or follow-ups lose context. Verify the ACP loadSession path end-to-end with bkd's `externalSessionId` reuse.
- **Packaging in package-mode deploy**: the agent must spawn from the deployed app dir (not just dev). Non-trivial; prove it in the deploy pipeline.
- **Tool safety**: Bash/Write run on the host fs in the worktree — same trust model as the CLI agents (single-user tool), but no sandbox; keep cwd-scoped.
- **Doesn't fix FE chat bugs** — be clear this is the engine side only.

## Alternatives
- **A new non-ACP executor wrapping the AI SDK** — rejected: bkd's ACP path already gives streaming/interleave/session/env/model-discovery for free; ACP is the cheap integration.
- **Keep only CLI engines** — rejected: user wants the clean native-streaming path + BYO multi-provider.

## Annotations
- 2026-06-08: Investigated aoe-agent (reference) + bkd ACP extension points. Confirmed: register a custom ACP agent (3 edits) + build the agent process; AcpExecutor handles the rest (streaming/interleave/session/env/models free). Proposal + decisions 1–5 pending `proceed`.
