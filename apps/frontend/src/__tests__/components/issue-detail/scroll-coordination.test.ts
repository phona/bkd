import { describe, expect, it } from 'vitest'
import { computeScrollAnchor, NEAR_BOTTOM_PX } from '@/components/issue-detail/scroll-coordination'

describe('computeScrollAnchor (BUG-005)', () => {
  it('reports atBottom when within the near-bottom threshold', () => {
    const anchor = computeScrollAnchor(
      { scrollTop: 970, scrollHeight: 1000, clientHeight: 30 },
      [{ id: 'a', top: -940 }, { id: 'b', top: -100 }],
    )
    expect(anchor).toEqual({ atBottom: true, anchorId: null })
  })

  it('treats exactly NEAR_BOTTOM_PX away as NOT at bottom', () => {
    const anchor = computeScrollAnchor(
      { scrollTop: 1000 - 100 - NEAR_BOTTOM_PX, scrollHeight: 1000, clientHeight: 100 },
      [{ id: 'a', top: -10 }, { id: 'b', top: 50 }],
    )
    expect(anchor.atBottom).toBe(false)
  })

  it('anchors to the top-most message at or below the viewport top edge', () => {
    const anchor = computeScrollAnchor(
      { scrollTop: 500, scrollHeight: 2000, clientHeight: 400 },
      [
        { id: 'old', top: -120 }, // scrolled above the top edge
        { id: 'visible', top: 8 }, // first one at/below the top edge
        { id: 'lower', top: 300 },
      ],
    )
    expect(anchor).toEqual({ atBottom: false, anchorId: 'visible' })
  })

  it('falls back to the last row above when none sit below the top edge', () => {
    const anchor = computeScrollAnchor(
      { scrollTop: 1500, scrollHeight: 2000, clientHeight: 400 },
      [{ id: 'a', top: -300 }, { id: 'b', top: -40 }],
    )
    expect(anchor).toEqual({ atBottom: false, anchorId: 'b' })
  })

  it('returns a null anchor when there are no messages and not at bottom', () => {
    const anchor = computeScrollAnchor(
      { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 },
      [],
    )
    expect(anchor).toEqual({ atBottom: false, anchorId: null })
  })
})
