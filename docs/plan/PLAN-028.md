# PLAN-028 Design constitution landing — semantic color + motion tokens

- **status**: implementing
- **createdAt**: 2026-06-06
- **approvedAt**: 2026-06-06
- **relatedTask**: DS-001

## Context

`DESIGN.md` (repo root) was approved as bkd's design constitution v1 on 2026-06-06
(4 pillars: Visual / Interaction / Component+Layout / Motion). This plan lands the
**mechanical, app-wide token work** from pillars A (Visual) and D (Motion) — the
foundation every later plan builds on.

Current state (audited 2026-06-06):
- `apps/frontend/src/index.css` uses oklch + shadcn vars, light/dark, radius scale,
  density tokens (PLAN-012). Plumbing is sound.
- `--accent` is chroma-0 (a dead gray); bkd has **no genuine accent color**.
- Semantic colors are scattered: raw hex in `src/lib/statuses.ts`
  (`todo #6b7280 / working #3b82f6 / review #f59e0b / done #22c55e`), a stray
  `#facc15`, chart colors, diff colors — 3–4 sources.
- Motion: 4 ad-hoc durations (`duration-100/150/200/300`), near-zero easing
  discipline, `transition-all` used ~35×, duplicate keyframes (`thinking-dot` +
  `thinking-pulse`), and **no `prefers-reduced-motion` support**.

## Proposal

Per DESIGN.md A.2/A.3 and D:
1. Add `--accent-brand` (teal, ~`oklch(0.58 0.10 195)` light / `0.72 0.11 195`
   dark) as a NEW token — do not repurpose shadcn `--accent`.
2. Introduce a semantic token layer (`--success / --warning / --error / --info /
   --neutral`) and map statuses to it; `statuses.ts` references tokens, holds no hex.
3. Rule: no raw color hex in TS/TSX/component CSS.
4. Motion tokens: `--duration-instant/fast/base/slow` (75/150/250/350ms) +
   `--ease-enter/exit/move`.
5. Replace all `transition-all` with specific `transition-colors/-transform/-opacity`.
6. Dedup keyframes (single thinking indicator); add `prefers-reduced-motion` guard
   that disables non-essential animation and protects Virtuoso lists.

Final accent hue/chroma and the four durations are DESIGN.md "Open Items" — confirm
exact values with the user before/at implementation.

## Risks

- Touches shared `index.css` and sweeps many components → visual regression surface.
  Mitigate: land tokens first, migrate call sites incrementally, eyeball per area.
- `prefers-reduced-motion` + Virtuoso interaction is a known bug area — test on the
  chat stream specifically.

## Scope

`apps/frontend/src/index.css`, `src/lib/statuses.ts`, plus a guided sweep for
`transition-all` and raw hex across `components/`.

## Alternatives

Full Tailwind 50–900 palette rebuild — rejected; bkd uses shadcn single-var model,
a rebuild is out of proportion to a self-use tool. Keep the existing model, fill gaps.

## Annotations

- 2026-06-06: Created as the foundation plan. PLAN-029/030/031 depend on this.
