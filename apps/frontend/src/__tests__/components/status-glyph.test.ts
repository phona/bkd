import { describe, expect, it } from 'vitest'
import { glyphForSession } from '@/components/ui/status-glyph'

describe('glyphForSession (PLAN-030)', () => {
  it('maps each session status to a distinct shape (not color-only)', () => {
    const glyphs = (['running', 'pending', 'completed', 'failed', 'cancelled'] as const).map(
      s => glyphForSession(s)!.glyph,
    )
    expect(new Set(glyphs).size).toBe(glyphs.length) // all shapes distinct
  })

  it('uses semantic token colors', () => {
    expect(glyphForSession('running')!.color).toBe('var(--success)')
    expect(glyphForSession('failed')!.color).toBe('var(--destructive)')
    expect(glyphForSession('pending')!.color).toBe('var(--warning)')
  })

  it('returns null for missing/unknown status', () => {
    expect(glyphForSession(null)).toBeNull()
    expect(glyphForSession(undefined)).toBeNull()
    expect(glyphForSession('whatever' as never)).toBeNull()
  })
})
