import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AcpTimeline } from '@/components/issue-detail/AcpTimeline'
import type { TimelineEntry } from '@/types/kanban'
import fixture from '../hooks/__fixtures__/issue-8d0nfwa6-logs.json'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

// Render EVERY item inline (real Virtuoso virtualizes; jsdom renders nothing) so
// each item renderer (command card, plan, thinking, tool group, LogEntry) is
// actually exercised against the real claude-code fixture.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data = [], itemContent }: { data?: unknown[], itemContent: (i: number, item: unknown) => ReactNode }) => (
    <div data-testid="virtuoso">
      {data.map((item, i) => <div key={(item as { id?: string }).id ?? i}>{itemContent(i, item)}</div>)}
    </div>
  ),
}))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(q => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  })
})

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('AcpTimeline — renders the real claude-code 8d0nfwa6 fixture (PLAN-043 regression guard)', () => {
  it('renders every item of the 8d0nfwa6 fixture without throwing', () => {
    const logs = (fixture as any).data.logs as TimelineEntry[]
    function Harness() {
      const scrollRef = useRef<HTMLDivElement>(null)
      const [ready, setReady] = useState(false)
      useLayoutEffect(() => setReady(true), [])
      return (
        <div ref={scrollRef} style={{ height: 500, overflow: 'auto' }}>
          {ready && <AcpTimeline logs={logs} scrollRef={scrollRef} isRunning={false} />}
        </div>
      )
    }
    expect(() => render(<Harness />, { wrapper: Wrapper })).not.toThrow()
  })
})
