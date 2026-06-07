# PLAN-029 Secretary — cockpit reborn as a push inbox (supersedes PLAN-022)

- **status**: draft
- **createdAt**: 2026-06-06
- **approvedAt**: (pending)
- **relatedTask**: COCKPIT-009 (to be created)
- **depends on**: PLAN-028
- **supersedes**: PLAN-022 / COCKPIT-008 (prior "secretary decision cards", stalled)

## Context

The cockpit was reworked repeatedly and abandoned: PLAN-014, 015, 016, 017, 018,
020, 022 are stale (`[-]`) or rejected (`[~]`). PLAN-022 ("Cockpit secretary —
AI-enriched decision cards + decision-stream UI", 2026-05-20) was approved but never
finished. Root cause (agreed with user 2026-06-06): the cockpit is a **pull**
surface — a dashboard you must remember to visit — so it loses to the chat the user
actually lives in.

Per DESIGN.md C.1 (IA), bkd is chat-first; the cockpit's slot is reserved for a
**push** secretary, not a dashboard.

## Proposal

Product name: **Dispatch**. A push-first triage secretary that watches issues
across all projects, **intercepts** what needs the user, and **advances** safe
stalled work — replacing the repeatedly-abandoned cockpit. Built on the one cockpit
habit the user actually keeps: the flat "all issues" overview.

### Behavior spine (decided)

1. **Delivery (tiered).** Default = ambient persistent badge ("N needs you").
   Escalate to a real push notification only for blocking items or items aged past a
   deterministic threshold.
2. **Autonomy.** L1 (draft + one-click execute) for everything; L2 (auto-advance)
   only for a small whitelist of safe mechanical actions. Trust is earned, not
   granted up front.
3. **Surface.** No heavy page. A thin cross-project flat issue stream — an upgrade of
   the existing all-issues view — reached from the ambient badge:
   - top zone "needs you (N)": decision cards floated up;
   - below: all issues, flat (the view the user already relies on).
   Cockpit's matrix / activity / recent-tabs / separate assistant panel are removed.

### Brain = a configurable prompt (the key simplification)

The structured policy matrix is replaced by a **global system prompt** that governs
Dispatch's judgment: what to surface, how to digest, what to recommend, which
candidate replies to draft, tone, and urgency. "Defaults" = an opinionated default
prompt encoding the MVP policy; "configurable" = edit that prompt. A future
per-project prompt layer can override the global one (out of MVP).

### Hard rails (deterministic — the prompt cannot exceed these)

Mouth = prompt; hands = guarded. 2–3 knobs only:
- **Auto-act master toggle** — may Dispatch execute actions at all.
- **Auto-action whitelist** — only these action types may be auto-executed; the
  prompt may decide freely *within* the whitelist, never outside. MVP whitelist =
  "nudge / continue a stalled session".
- **Push escalation threshold** — deterministic minutes; the prompt influences
  urgency, but the actual notification trigger is not left to LLM whim.

### Watch list (5 signals; MVP = ① + ②)

① waiting for your reply · ② stalled (no progress) · ③ mergeable · ④ off-track ·
⑤ repeated failures. MVP wires ① (L1 draft) + ② (L2 auto-nudge, whitelisted);
③ detection-on / surface-only; ④⑤ off by default but present in the framework.

### Architecture (reuses PLAN-022's good parts)

```
event → cheap rule pre-filter (which issue to look at)
      → Dispatch enrichment (engine-neutral AI pass via the issue pipeline; reads the
        last turn, driven by the global prompt → digest + recommendation + candidate
        replies, OR an auto-handle verdict if within the whitelist)
      → policy: delivery urgency (prompt) gated by push threshold (hard rail);
        auto-act gated by master toggle + whitelist (hard rails)
      → decision card into the flat stream (shown instantly with the rule template,
        patched via SSE once enrichment returns)
```

- **Decision card**: reuse PLAN-022's schema — situation line, dominant
  recommendation + reasoning, 2–3 `reply-preset` candidate buttons, free-text escape
  hatch (always present), collapsed detail.
- **Engine-neutral**: enrichment runs on the user-selected engine
  (`dispatch:engine` setting), serialized through one hidden singleton issue.
- **Reasoning is logged**: Dispatch records why it surfaced/acted, so prompt-driven
  behavior stays debuggable.

### Divergences from PLAN-022 (why this one should stick)

- Push is the **spine**, not an M3 afterthought.
- Surface = an **upgrade of the habit the user actually uses** (flat all-issues), not
  a new decision-stream page they will ignore.
- **Configurability via a prompt** (PLAN-022 put config out of scope) — deliberately
  reversed at the user's request, kept simple (one prompt + 2–3 hard rails).
- Renamed cockpit/secretary → **Dispatch**.

## Risks

- Easy to slide back into a PM dashboard → re-abandoned. Guard with the
  action-vs-organization line from DESIGN.md.
- Auto-advance acting without consent → must respect B-4 (no silent action) and
  B-5 (destructive predictable).

## Scope

MVP (in):
- Signals ① + ②; global Dispatch prompt + opinionated default; `dispatch:engine` setting.
- Flat cross-project stream surface (needs-you on top + all-issues flat); ambient
  badge; push with deterministic threshold.
- L1 draft for ①; L2 auto-nudge for ② (whitelist); reuse decision card +
  `reply-preset` dispatch.
- Hard rails: auto-act master toggle, action whitelist, push threshold.
- Mobile parity (hard requirement); i18n en + zh.
- Remove cockpit matrix / activity / recent-tabs / assistant panel (keep behind a
  disclosure until confirmed unused). Replaces `components/cockpit/` (14 files / 2219 lines).

Out:
- ③④⑤ active logic (framework only); per-project prompt layer; autonomy beyond the
  whitelist; multi-repo / teams / issue-linking.

## Alternatives

(a) Cut cockpit entirely; (b) keep as demoted overview. Rejected by user 2026-06-06
in favor of (c) rebuild as push secretary.

## Annotations

- 2026-06-06: Created. Next action = dedicated brainstorm for the secretary.
- 2026-06-06: Borrow AoE's **notification suppression/escalation rules** into Delivery:
  in-app toast when the dashboard is focused, suppress when any browser is active,
  send a real push immediately for blocking items / past the aged threshold, per-issue
  cooldown. This is the concrete plumbing for the tiered (C) delivery.
- 2026-06-06: **Auto-mode adjustment** — the user runs agents in auto/bypass mode and
  rarely approves per-permission. So weight signals **② stalled / ⑤ failed / ③
  mergeable** over ① waiting-for-reply, and do NOT build heavy approval-card UX.
  Steering happens post-hoc via diff review (see PLAN-035), not approval gates.
- 2026-06-06: Brainstormed full design. Decided — name **Dispatch**; delivery = C
  (tiered ambient→push); autonomy = L1 everywhere + L2 small whitelist; surface = B
  (thin flat stream = upgrade of the all-issues view); brain = configurable global
  prompt; safety = prompt + 2–3 deterministic hard rails; MVP = signals ①②. Status
  stays `draft` pending explicit `proceed` to implement.
