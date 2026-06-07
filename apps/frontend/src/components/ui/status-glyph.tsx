import type { SessionStatus } from '@/types/kanban'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

// Status glyph (PLAN-030 / DESIGN.md A.3): shape + color, never color alone, so
// session state survives color-blindness, low contrast, and grayscale. Colors
// come from the semantic tokens landed in PLAN-028.

interface GlyphSpec {
  glyph: string
  color: string
  /** i18n key suffix under `session.status.*`. */
  key: string
}

export function glyphForSession(status: SessionStatus | null | undefined): GlyphSpec | null {
  switch (status) {
    case 'running':
      return { glyph: '●', color: 'var(--success)', key: 'running' }
    case 'pending':
      return { glyph: '◌', color: 'var(--warning)', key: 'pending' }
    case 'completed':
      return { glyph: '○', color: 'var(--neutral)', key: 'completed' }
    case 'failed':
      return { glyph: '✕', color: 'var(--destructive)', key: 'failed' }
    case 'cancelled':
      return { glyph: '■', color: 'var(--neutral)', key: 'cancelled' }
    default:
      return null
  }
}

export function StatusGlyph({
  status,
  className,
}: {
  status?: SessionStatus | null
  className?: string
}) {
  const { t } = useTranslation()
  const spec = glyphForSession(status)
  if (!spec) return null
  const label = t(`session.status.${spec.key}`)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('inline-block text-[10px] leading-none', spec.key === 'running' && 'animate-pulse', className)}
      style={{ color: spec.color }}
    >
      {spec.glyph}
    </span>
  )
}
