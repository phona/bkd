# DESIGN.md — bkd Design Constitution

> The single source of truth for how bkd looks and behaves. Every UI change
> measures against this file. It holds **conventions and target maps**, not
> implementation details (do not put "how to split ChatInput" here).
>
> Status: **APPROVED v1** (2026-06-06). Open Items at the bottom are tracked and
> non-blocking (accent hue, motion durations, custom font).

## Product Context

- **What this is:** A self-hosted, engine-neutral, mobile chat tool for driving
  CLI coding agents. **Chat-first.** A board and (future) secretary surface
  support the conversation; they do not replace it.
- **Who it's for:** A single operator (the author) driving agents day to day.
  The litmus test for any surface: *does it make driving the agent better?*
  Organizing/tracking issues for their own sake is out of scope.
- **Aesthetic direction:** Calm, cool, professional. Restraint over decoration —
  like Linear/Vercel, not a neon terminal. Personality comes from discipline and
  one confident accent, not ornament.
- **Reference (taste only, not a competitor):** Agent of Empires' discipline —
  one documented system that constrains everything.

---

## A. Visual System

bkd already uses oklch + the shadcn token model with light/dark themes, a radius
scale, and density tokens (PLAN-012). The plumbing is sound. This section fixes
three real gaps: (1) no genuine accent color, (2) semantic/status colors scattered
as raw hex outside the token system, (3) no documented identity.

### A.1 Identity

Direction **①: keep the existing cool-blue primary, add one real accent, unify
the scattered semantic colors.** Lowest-risk path that kills both "monotone" and
"scattered" at once. No rebrand, nothing to relearn.

### A.2 Color tokens (oklch, shadcn var model)

Keep existing `--primary` (blue, hue 250). The dead `--accent` (currently
chroma-0 gray) stays as shadcn's neutral hover surface — **do not** repurpose it.
Introduce a genuine brand accent as a new token so existing components don't break.

| Token | Role | Light | Dark |
|-------|------|-------|------|
| `--primary` | Primary actions, links, focus (KEEP) | `oklch(0.46 0.16 250)` | `oklch(0.72 0.15 250)` |
| `--accent-brand` | **NEW** — secondary emphasis, branch names, active markers | `oklch(0.58 0.10 195)` (teal) | `oklch(0.72 0.11 195)` |
| `--accent` | Neutral hover surface (KEEP, shadcn semantic) | `oklch(0.92 0 0)` | `oklch(0.315 0 0)` |
| surfaces/neutrals | background/card/muted/border (KEEP) | existing | existing |

> Accent = teal (hue ~195), complementary-cool to the blue primary. This is the
> one value most worth eyeballing — adjust hue/chroma to taste before approval.

### A.3 Semantic & status colors (UNIFY — single source)

Today status colors live as raw hex in `src/lib/statuses.ts`, plus a stray
`#facc15`, plus chart colors, plus diff colors — 3–4 places. **Collapse into one
semantic token layer**; `statuses.ts` must reference these tokens, not hold hex.

| Semantic | Meaning | Status mapping | Color (light) |
|----------|---------|----------------|---------------|
| `--success` | done / confirmed | `done` | `oklch(0.65 0.17 145)` (green) |
| `--warning` | needs attention / review | `review` | `oklch(0.72 0.16 70)` (amber) |
| `--error` | failed / destructive | (session failed) | `--destructive` (red, exists) |
| `--info` | active / running | `working` | `--primary` (blue) |
| `--neutral` | idle / not started | `todo` | `oklch(0.5 0 0)` (slate) |

Rule: **no raw color hex in TS/TSX or component CSS.** Every color resolves
through a token. One concept, one token, one place.

### A.4 Typography

- **v1: keep the system font stack** (`--font-sans`, `--font-mono` as-is). It's
  the lowest priority gap and "system is fine" for a personal tool.
- **Scale (codify):** 11 / 12 / 13 / 14 / 16 / 18 / 20 / 24 / 32 px. Sub-16px is
  desktop-density only; mobile inputs already floor at 16px (anti-zoom rule kept).
- **Open decision (deferred):** adding one display/UI font for personality —
  tracked, not blocking v1.

### A.5 Spacing / radius / density

- **Spacing:** 4px base. Scale `2 / 4 / 8 / 12 / 16 / 24 / 32 / 48`.
- **Radius (KEEP):** sm `0.25` / md `0.375` / lg `0.5` / xl `0.75` rem.
- **Density (KEEP — PLAN-012):** icon `14/16/20`, control height `24/28/32/36`.
  Keep ranges tight. Every extra tier is a license for inconsistency.

---

## B. Interaction System

Behavior discipline: **one kind of action has exactly one way to do it, app-wide.**

1. **Progressive disclosure.** Common path shows the minimum; advanced options
   collapse behind "Advanced". (CreateIssueDialog, and the future-split ChatInput.)
2. **The correct thing is the default.** Default to the right choice and remember
   the last one. (git project → worktree on; remember last engine/model.)
3. **State is always glanceable.** running / waiting / done / error use the
   unified A.3 color + a consistent glyph, shown the same way on card, list, and
   detail.
4. **Never fail silently.** Every action either succeeds with feedback or fails
   visibly. No "looked fine, actually didn't" (e.g. worktree creation failure).
5. **Destructive actions are predictable and recoverable.** Unified confirm +
   smart-preset pattern (AoE's delete dialog is the reference).
6. **Mobile is not second-class.** Every desktop interaction has a mobile
   equivalent. No `max-md:hidden` as a substitute for design. (Hard constraint.)
7. **One primitive, one usage.** dialog / drawer / chip / badge / confirm behave
   identically everywhere; no per-feature reinvention.

(Optional, adopt if keyboard-driven: **dual-channel** — power actions get
shortcuts/command-palette but everything is also clickable.)

---

## C. Component & Layout System

Structure discipline — the antidote to 700–1700-line files and homeless components.

1. **Layers, one-way deps.** `ui/` primitives → area feature components →
   `pages/` shells. Dependencies flow one way only: features use primitives,
   never the reverse; **areas do not import each other** — shared code sinks to
   `ui/` or `lib/`.
2. **Every component has a home.** Nothing loose in `components/` root.
   (`AppSettingsDialog`, `ProjectSettingsDialog` → `settings/`.) A component
   belongs to exactly one area.
3. **Size / responsibility line.** Soft ceiling ~300 lines = "split me" signal.
   One component, one job. Separate container (data/state) from presentation
   (pure render).
4. **State ownership rule.** Server state → React Query. Cross-component UI state
   → Zustand. Local → useState. Define what *earns* its own store (the current 13
   has mergeable ones: chat-filter / chat-search / scroll-position).
5. **IA map.** See below — what is a page vs panel vs drawer, and how surfaces
   relate.

### C.1 Information Architecture

- **Primary surface: the conversation** (issue-detail chat). This is bkd's reason
  to exist; usage confirms it. Everything else supports it.
- **Board (kanban):** secondary entry/overview. Not the home base.
- **Secretary (future, replaces cockpit):** a **push** surface — an inbox that
  comes to you (intercept what needs you, advance what stalled), NOT a pull-style
  dashboard. Action-oriented, not organization-oriented (stays on the right side
  of the PM line). Designed in its own spec; this map reserves its slot.
- **Drawers (auxiliary):** terminal, files, processes, notes — transient, opened
  on demand, never the main stage.
- **Rule of thumb:** persistent destination → page; contextual companion to the
  current page → panel; transient utility → drawer.

---

## D. Motion System

Today: 4 ad-hoc durations, near-zero easing discipline, 35× `transition-all`,
duplicate keyframes, and **no reduced-motion support**. Fix:

1. **Duration scale (tokenize).** `--duration-instant 75ms` / `--duration-fast
   150ms` / `--duration-base 250ms` / `--duration-slow 350ms`. Only these.
2. **Easing curves (tokenize).** `--ease-enter` (ease-out) / `--ease-exit`
   (ease-in) / `--ease-move` (ease-in-out). No one-off `ease-in-out`.
3. **Minimal-functional.** Motion serves feedback / orientation / state change
   only (entrance, status change, thinking, drawer open). No decorative motion.
4. **Ban `transition-all`.** Use specific `transition-colors / -transform /
   -opacity`. Fixes the 35 jank sites.
5. **Keyframe dedup + intake control.** One thinking indicator (drop the
   duplicate). Every keyframe needs a reason; no proliferation.
6. **Respect `prefers-reduced-motion`.** Hard rule: reduced-motion disables all
   non-essential animation. Per-item list entrance must not fight Virtuoso
   virtualization (a known bug source).

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-06 | Constitution scoped to 4 pillars: Visual / Interaction / Component+Layout / Motion | Both "looks messy" and "code messy" need discipline; tokens alone aren't enough |
| 2026-06-06 | Identity direction ①: keep cool-blue primary, add teal accent, unify semantic colors | Self-use tool; comfort over rebrand; lowest-risk fix for monotone + scatter |
| 2026-06-06 | cockpit → future "secretary" (push/inbox), not a pull dashboard | v1 cockpit went unused because it was pull; secretary intercepts+advances, stays chat-first and off the PM path |
| 2026-06-06 | Typography: keep system fonts for v1; custom font deferred | Lowest-priority gap; not blocking |

## Open Items (not blocking v1)

- Accent hue/chroma final value (A.2) — eyeball before approval.
- Add a display/UI font for personality (A.4).
- Confirm `cockpit/`'s exact current role before drawing final IA edges (C.1).
