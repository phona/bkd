/**
 * Derive a git branch name from an issue title, mirroring AoE's
 * session-title → branch behaviour. Lowercases, replaces runs of
 * non-alphanumeric characters with a single hyphen, trims leading/trailing
 * hyphens, and caps the length. Falls back to `bkd/{id}` when the title
 * produces an empty slug (e.g. an emoji-only or whitespace title).
 */
export function slugifyBranch(title: string, id: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')

  return slug ? `bkd/${slug}` : `bkd/${id || 'issue'}`
}
