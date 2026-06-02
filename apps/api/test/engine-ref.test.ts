import { describe, expect, it } from 'bun:test'
import { getEngine, setEngine } from '@/engines/issue/engine-ref'

describe('engine accessor', () => {
  it('returns a default engine, and setEngine overrides it', () => {
    const first = getEngine()
    expect(typeof first.executeIssue).toBe('function') // it is an IssueEngine
    const stub = { executeIssue() {} } as any
    setEngine(stub)
    expect(getEngine()).toBe(stub)
    setEngine(first) // restore for other tests in the same process
  })
})
