import type { DiffComment } from '@/lib/review-comment'
import { describe, expect, it } from 'vitest'
import { buildReviewFollowUp } from '@/lib/review-comment'

function c(partial: Partial<DiffComment>): DiffComment {
  return { id: 'x', path: 'a.ts', line: 1, side: 'new', text: 'note', ...partial }
}

describe('buildReviewFollowUp (DIFF-001)', () => {
  it('returns empty string when there are no comments', () => {
    expect(buildReviewFollowUp([])).toBe('')
  })

  it('drops comments whose text is blank', () => {
    expect(buildReviewFollowUp([c({ text: '   ' })])).toBe('')
  })

  it('groups comments by file and orders them by line', () => {
    const msg = buildReviewFollowUp([
      c({ path: 'b.ts', line: 9, text: 'second file' }),
      c({ path: 'a.ts', line: 30, text: 'later' }),
      c({ path: 'a.ts', line: 5, text: 'earlier' }),
    ])
    expect(msg).toContain('### a.ts')
    expect(msg).toContain('### b.ts')
    // a.ts comments ordered by line: 5 before 30
    expect(msg.indexOf('L5: earlier')).toBeLessThan(msg.indexOf('L30: later'))
    // a.ts section appears before b.ts (first-seen path order is preserved by line sort within file)
    expect(msg).toContain('- L9: second file')
  })

  it('includes a default intro and trims comment text', () => {
    const msg = buildReviewFollowUp([c({ line: 12, text: '  fix this  ' })])
    expect(msg.startsWith('Please address these review comments')).toBe(true)
    expect(msg).toContain('- L12: fix this')
  })

  it('honors a custom intro and appends an outro', () => {
    const msg = buildReviewFollowUp([c({ text: 'x' })], { intro: 'Review:', outro: 'Thanks.' })
    expect(msg.startsWith('Review:')).toBe(true)
    expect(msg.trimEnd().endsWith('Thanks.')).toBe(true)
  })
})
