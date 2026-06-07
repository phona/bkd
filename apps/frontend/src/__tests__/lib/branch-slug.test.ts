import { describe, expect, it } from 'vitest'
import { slugifyBranch } from '@/lib/branch-slug'

describe('slugifyBranch', () => {
  it('slugs a simple title under the bkd/ prefix', () => {
    expect(slugifyBranch('Fix the login bug', 'abc123')).toBe('bkd/fix-the-login-bug')
  })

  it('collapses runs of non-alphanumeric characters into single hyphens', () => {
    expect(slugifyBranch('Add  OAuth / PKCE!!!', 'id')).toBe('bkd/add-oauth-pkce')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugifyBranch('  --weird title--  ', 'id')).toBe('bkd/weird-title')
  })

  it('falls back to bkd/{id} when the title produces an empty slug', () => {
    expect(slugifyBranch('🎉🎉🎉', 'fallback9')).toBe('bkd/fallback9')
    expect(slugifyBranch('   ', 'fallback9')).toBe('bkd/fallback9')
  })

  it('caps the slug length', () => {
    const long = 'a'.repeat(200)
    const out = slugifyBranch(long, 'id')
    // bkd/ prefix + up to 60 slug chars
    expect(out.length).toBeLessThanOrEqual('bkd/'.length + 60)
    expect(out.startsWith('bkd/')).toBe(true)
  })
})
