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
