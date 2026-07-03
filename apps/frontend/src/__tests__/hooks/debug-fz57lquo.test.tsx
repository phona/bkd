import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, it } from 'vitest'
import { useAcpTimeline } from '@/hooks/use-acp-timeline'
import type { TimelineEntry } from '@/types/kanban'

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('debug fz57lquo', () => {
  it('inspect', async () => {
    const res = await fetch('http://localhost:3010/api/projects/bontopdesignlog/issues/fz57lquo/logs')
    const json = await res.json()
    const logs: TimelineEntry[] = json.data.logs
    const { result } = renderHook(() => useAcpTimeline(logs), { wrapper: createWrapper() })
    const items = result.current.items
    console.log('items', items.map((i: any) => ({
      type: i.type,
      entryType: i.entry?.entryType,
      thinking: i.thinking ? i.thinking.content.slice(0, 60) : undefined,
      content: i.entry?.content?.slice(0, 60) ?? i.message?.items?.[0]?.action?.content?.slice(0, 60),
    })))
  })
})
