export type StatusId = 'todo' | 'working' | 'review' | 'done'

export interface StatusDefinition {
  id: StatusId
  name: string
  color: string
  sortOrder: number
}

// Colors reference the semantic status tokens (PLAN-028) so status indicators
// theme correctly in light/dark. Consumers that need a translucent tint use
// `color-mix(in oklch, <color> N%, transparent)` rather than hex-alpha suffixes.
export const STATUSES: StatusDefinition[] = [
  { id: 'todo', name: 'Todo', color: 'var(--neutral)', sortOrder: 0 },
  { id: 'working', name: 'Working', color: 'var(--info)', sortOrder: 1 },
  { id: 'review', name: 'Review', color: 'var(--warning)', sortOrder: 2 },
  { id: 'done', name: 'Done', color: 'var(--success)', sortOrder: 3 },
]

export const STATUS_MAP = new Map<string, StatusDefinition>(STATUSES.map(s => [s.id, s]))

export const DEFAULT_STATUS_ID: StatusId = 'todo'
