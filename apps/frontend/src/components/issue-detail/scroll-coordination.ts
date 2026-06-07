// Coordinates programmatic scrolls (ChatBody) with the title auto-hide gesture
// detector (ChatArea), which share the same scroll container via `scrollRef`.
//
// The auto-hide state machine must react ONLY to genuine user scroll gestures.
// ChatBody performs several PROGRAMMATIC scrolls — the ResizeObserver
// counter-scroll that compensates when chrome (title/metadata/input) toggles,
// the saved-position restore, and the scroll-to-top/bottom buttons. Those fire
// `scroll` events indistinguishable from a finger drag, so without a signal the
// auto-hide reads them as gestures and flips the bar — which collapses the
// metadata bar, which triggers another compensating scroll, which flips again:
// the bar flaps between shown/hidden indefinitely.
//
// We stamp a short "ignore until" deadline on the scroll element right before a
// programmatic scroll; the auto-hide handler skips gesture detection while the
// stamp is live. Stored on the DOM node itself so both components can read it
// without prop threading.

const STAMP_KEY = '__bkdProgrammaticScrollUntil'

type StampedElement = HTMLElement & { [STAMP_KEY]?: number }

/**
 * Mark the element as undergoing a programmatic scroll for the next `ms`.
 * Use a longer window for `behavior: 'smooth'` scrolls (they emit events across
 * the whole animation) and the short default for instant `scrollTop` sets.
 */
export function markProgrammaticScroll(el: HTMLElement | null, ms = 150): void {
  if (!el) return
  const stamped = el as StampedElement
  stamped[STAMP_KEY] = performance.now() + ms
}

/** True while a programmatic scroll stamp on the element is still live. */
export function isProgrammaticScroll(el: HTMLElement | null): boolean {
  if (!el) return false
  return performance.now() < ((el as StampedElement)[STAMP_KEY] ?? 0)
}

// ── Per-issue scroll restore anchoring (BUG-005) ─────────────────────────────
//
// We used to persist an ABSOLUTE pixel scrollTop per issue and write it back on
// switch. That anchor drifts: async Shiki/markdown/diff rendering grows the
// content height after the restore, and new messages may have arrived while
// away, so the saved pixel points at the wrong message and is no longer at the
// bottom. Instead we persist a SEMANTIC anchor: either "was at bottom" (follow
// the latest) or the messageId at the top of the viewport (resume reading).

/** Distance from the bottom (px) within which we treat the user as "following". */
export const NEAR_BOTTOM_PX = 40

export interface ScrollAnchor {
  /** User was following the latest message → restore should land at the bottom. */
  atBottom: boolean
  /** messageId at the top of the viewport when reading history; null if atBottom. */
  anchorId: string | null
}

/**
 * Derive the semantic scroll anchor from the container metrics and the vertical
 * positions of the rendered message rows (each `top` is relative to the scroll
 * container's top edge, in px). Pure so it can be unit-tested without layout.
 */
export function computeScrollAnchor(
  metrics: { scrollTop: number, scrollHeight: number, clientHeight: number },
  messageTops: Array<{ id: string, top: number }>,
): ScrollAnchor {
  const { scrollTop, scrollHeight, clientHeight } = metrics
  if (scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_PX) {
    return { atBottom: true, anchorId: null }
  }
  // Top-most message at/below the viewport top edge; fall back to the last row
  // above it so a partially-scrolled-past message still anchors.
  const firstBelow = messageTops.find(m => m.top >= 0)
  const anchor = firstBelow ?? messageTops.at(-1) ?? null
  return { atBottom: false, anchorId: anchor?.id ?? null }
}
