# PLAN-035 Diff inline comments → send to agent (borrowed from AoE)

- **status**: draft
- **createdAt**: 2026-06-06
- **approvedAt**: (pending)
- **relatedTask**: DIFF-001 (to be created)

## Context

Borrowed from AoE's diff-view. bkd has `DiffPanel` but it is **view-only** — you can
see what the agent changed but cannot annotate and instruct from there.

This matters most because the user runs agents in **auto/bypass mode** (rarely
approves per-permission). For an auto-driver, the primary steering happens **after**
a run, by reviewing the diff — so an inline-comment → send-to-agent loop is the real
"steering wheel", not approval gates. Pure chat-first: review → instruct, in one place.

## Proposal

On `DiffPanel`:
- Hover a diff line → gutter `+` → compose an inline comment (Markdown).
- Batch **"Send to agent"**: collected comments become a single follow-up (editable
  intro / comments / outro), optionally clearing the thread after send.
- Stale-comment detection: if the line range no longer matches, move to a stale block.
- Persist comments locally (per-issue) until sent.
- Mobile parity (hard requirement).

## Risks

- Mapping a comment to a stable line across re-diffs (stale detection is the tricky part).
- Keep the follow-up dispatch consistent with the existing message/follow-up path.

## Scope

`DiffPanel.tsx` + a comments store + the follow-up dispatch path. Benefits from
PLAN-028 tokens but does not hard-depend on it.

## Alternatives

Keep diff view-only and steer purely via chat — rejected; the user's auto-mode habit
makes post-hoc diff review the main steering surface, so this is high-value.

## Annotations

- 2026-06-06: Created from the AoE feature sweep. Top "steal" pick given auto-mode usage.
