// Diff review comments → a single agent follow-up message (PLAN-035 / DIFF-001).
//
// Pure helpers so the message shape can be unit-tested without the diff UI.

export interface DiffComment {
  id: string
  /** Repo-relative file path the comment is anchored to. */
  path: string
  /** 1-based line number within the file. */
  line: number
  /** Which side of the diff the line belongs to. */
  side: 'old' | 'new'
  /** The reviewer's note (Markdown). */
  text: string
}

const DEFAULT_INTRO = 'Please address these review comments on the current diff:'

/**
 * Build one follow-up message from a set of diff comments, grouped by file and
 * ordered by line. Empty comments are dropped; returns '' when nothing to send.
 */
export function buildReviewFollowUp(
  comments: DiffComment[],
  opts?: { intro?: string, outro?: string },
): string {
  const valid = comments.filter(c => c.text.trim().length > 0)
  if (valid.length === 0) return ''

  const byPath = new Map<string, DiffComment[]>()
  for (const c of valid) {
    const arr = byPath.get(c.path)
    if (arr) arr.push(c)
    else byPath.set(c.path, [c])
  }

  const sections: string[] = []
  for (const [path, list] of byPath) {
    const lines = [...list]
      .sort((a, b) => a.line - b.line)
      .map(c => `- L${c.line}: ${c.text.trim()}`)
      .join('\n')
    sections.push(`### ${path}\n${lines}`)
  }

  const intro = (opts?.intro ?? DEFAULT_INTRO).trim()
  const parts = [intro, '', sections.join('\n\n')]
  const outro = opts?.outro?.trim()
  if (outro) parts.push('', outro)
  return parts.join('\n')
}
