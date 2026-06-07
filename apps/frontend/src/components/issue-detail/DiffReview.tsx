import type { AnnotationSide, DiffLineAnnotation } from '@pierre/diffs/react'
import type { DiffComment } from '@/lib/review-comment'
import { Bot, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFollowUpIssue } from '@/hooks/use-kanban'
import { buildReviewFollowUp } from '@/lib/review-comment'
import { useDiffCommentsStore } from '@/stores/diff-comments-store'

// @pierre uses 'deletions'/'additions'; our store uses 'old'/'new'.
function sideToAnno(side: DiffComment['side']): AnnotationSide {
  return side === 'old' ? 'deletions' : 'additions'
}
function annoToSide(side: AnnotationSide): DiffComment['side'] {
  return side === 'deletions' ? 'old' : 'new'
}

interface HoveredLine { lineNumber: number, side: AnnotationSide }

/**
 * Wires the diff-review comment store into a single file's @pierre MultiFileDiff:
 * a hover "+" to start a comment, inline annotation rows for existing comments,
 * and a draft composer. Returns props to spread onto the diff component.
 */
export function useReviewAnnotations(issueId: string, path: string) {
  const all = useDiffCommentsStore(s => s.byIssue[issueId])
  const add = useDiffCommentsStore(s => s.add)
  const update = useDiffCommentsStore(s => s.update)
  const remove = useDiffCommentsStore(s => s.remove)
  const [draft, setDraft] = useState<{ line: number, side: AnnotationSide } | null>(null)

  const pathComments = useMemo(
    () => (all ?? []).filter(c => c.path === path),
    [all, path],
  )

  const lineAnnotations = useMemo<DiffLineAnnotation<unknown>[]>(() => {
    const seen = new Set<string>()
    const out: DiffLineAnnotation<unknown>[] = []
    const push = (side: AnnotationSide, lineNumber: number) => {
      const k = `${side}:${lineNumber}`
      if (seen.has(k)) return
      seen.add(k)
      out.push({ side, lineNumber, metadata: undefined })
    }
    for (const c of pathComments) push(sideToAnno(c.side), c.line)
    if (draft) push(draft.side, draft.line)
    return out
  }, [pathComments, draft])

  const renderHoverUtility = useCallback(
    (getHoveredLine: () => HoveredLine | undefined) => (
      <button
        type="button"
        aria-label="add-comment"
        className="flex size-4 items-center justify-center rounded bg-[var(--accent-brand)] text-white shadow-sm transition-transform hover:scale-110"
        onClick={() => {
          const h = getHoveredLine()
          if (h) setDraft({ line: h.lineNumber, side: h.side })
        }}
      >
        <Plus className="size-3" strokeWidth={3} />
      </button>
    ),
    [],
  )

  const renderAnnotation = useCallback(
    (a: DiffLineAnnotation<unknown>) => {
      const side = annoToSide(a.side)
      const comments = pathComments.filter(c => c.line === a.lineNumber && c.side === side)
      const draftActive = !!draft && draft.line === a.lineNumber && draft.side === a.side
      return (
        <DiffCommentBox
          comments={comments}
          draftActive={draftActive}
          onSave={(text) => {
            add(issueId, { path, line: a.lineNumber, side, text })
            setDraft(null)
          }}
          onUpdate={(id, text) => update(issueId, id, text)}
          onRemove={id => remove(issueId, id)}
          onCancelDraft={() => setDraft(null)}
          onReply={() => setDraft({ line: a.lineNumber, side: a.side })}
        />
      )
    },
    [pathComments, draft, add, update, remove, issueId, path],
  )

  return { lineAnnotations, renderHoverUtility, renderAnnotation }
}

function DiffCommentBox({
  comments,
  draftActive,
  onSave,
  onUpdate,
  onRemove,
  onCancelDraft,
  onReply,
}: {
  comments: DiffComment[]
  draftActive: boolean
  onSave: (text: string) => void
  onUpdate: (id: string, text: string) => void
  onRemove: (id: string) => void
  onCancelDraft: () => void
  onReply: () => void
}) {
  const { t } = useTranslation()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [draftText, setDraftText] = useState('')

  return (
    <div className="my-1 space-y-1.5 rounded-lg border border-[var(--accent-brand)]/30 bg-[var(--accent-brand)]/5 p-2 text-xs">
      {comments.map(c => (
        <div key={c.id} className="group/c">
          {editingId === c.id ?
              (
                <div className="space-y-1">
                  <textarea
                    autoFocus
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    className="w-full resize-none rounded border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:border-[var(--accent-brand)]/60"
                    rows={2}
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded bg-[var(--accent-brand)] px-1.5 py-0.5 text-[11px] text-white disabled:opacity-50"
                      disabled={!editText.trim()}
                      onClick={() => {
                        onUpdate(c.id, editText.trim()); setEditingId(null)
                      }}
                    >
                      <Check className="size-3" />
                      {t('diff.review.save')}
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/60"
                      onClick={() => setEditingId(null)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) :
              (
                <div className="flex items-start gap-1.5">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/90">{c.text}</p>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover/c:opacity-100">
                    <button
                      type="button"
                      aria-label="edit"
                      className="rounded p-0.5 hover:bg-muted/60"
                      onClick={() => {
                        setEditingId(c.id); setEditText(c.text)
                      }}
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="delete"
                      className="rounded p-0.5 text-[var(--danger,#dc2626)] hover:bg-muted/60"
                      onClick={() => onRemove(c.id)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              )}
        </div>
      ))}

      {draftActive ?
          (
            <div className="space-y-1">
              <textarea
                autoFocus
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                placeholder={t('diff.review.placeholder')}
                className="w-full resize-none rounded border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:border-[var(--accent-brand)]/60"
                rows={2}
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded bg-[var(--accent-brand)] px-1.5 py-0.5 text-[11px] text-white disabled:opacity-50"
                  disabled={!draftText.trim()}
                  onClick={() => {
                    onSave(draftText.trim()); setDraftText('')
                  }}
                >
                  <Check className="size-3" />
                  {t('diff.review.save')}
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/60"
                  onClick={() => {
                    setDraftText(''); onCancelDraft()
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) :
        comments.length > 0 ?
            (
              <button
                type="button"
                className="text-[11px] text-[var(--accent-brand)] hover:underline"
                onClick={onReply}
              >
                {t('diff.review.add')}
              </button>
            ) :
          null}
    </div>
  )
}

/**
 * Footer bar shown when the issue has diff comments: count + send-to-agent
 * (with an editable intro/outro preview) + clear.
 */
export function ReviewSendBar({ projectId, issueId }: { projectId: string, issueId: string }) {
  const { t } = useTranslation()
  const all = useDiffCommentsStore(s => s.byIssue[issueId])
  const clear = useDiffCommentsStore(s => s.clear)
  const followUp = useFollowUpIssue(projectId)
  const [open, setOpen] = useState(false)
  const [intro, setIntro] = useState('')
  const [outro, setOutro] = useState('')
  const [clearAfter, setClearAfter] = useState(true)

  const comments = useMemo(() => all ?? [], [all])
  const preview = useMemo(
    () => buildReviewFollowUp(comments, { intro: intro.trim() || undefined, outro: outro.trim() || undefined }),
    [comments, intro, outro],
  )

  if (comments.length === 0) return null

  const send = async () => {
    if (!preview.trim() || followUp.isPending) return
    await followUp.mutateAsync({ issueId, prompt: preview, busyAction: 'queue' })
    if (clearAfter) clear(issueId)
    setOpen(false)
    setIntro('')
    setOutro('')
  }

  return (
    <div className="sticky bottom-0 z-10 border-t border-border/50 bg-card/95 backdrop-blur-sm">
      {open ?
          (
            <div className="space-y-2 px-3 py-2 text-xs">
              <textarea
                value={intro}
                onChange={e => setIntro(e.target.value)}
                placeholder={t('diff.review.introPlaceholder')}
                rows={2}
                className="w-full resize-none rounded border border-border/60 bg-background px-2 py-1 outline-none focus:border-[var(--accent-brand)]/60"
              />
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-[11px] text-foreground/80">{preview}</pre>
              <textarea
                value={outro}
                onChange={e => setOutro(e.target.value)}
                placeholder={t('diff.review.outroPlaceholder')}
                rows={2}
                className="w-full resize-none rounded border border-border/60 bg-background px-2 py-1 outline-none focus:border-[var(--accent-brand)]/60"
              />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={clearAfter} onChange={e => setClearAfter(e.target.checked)} />
                {t('diff.review.clearAfter')}
              </label>
            </div>
          ) :
        null}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="text-xs font-medium text-foreground hover:underline"
          onClick={() => setOpen(o => !o)}
        >
          {t('diff.review.count', { count: comments.length })}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60"
            onClick={() => clear(issueId)}
          >
            <X className="mr-1 inline size-3" />
            {t('diff.review.clear')}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--accent-brand)' }}
            disabled={followUp.isPending || !preview.trim()}
            onClick={() => {
              void send()
            }}
          >
            <Bot className="size-3.5" />
            {followUp.isPending ? t('diff.review.sending') : t('diff.review.send')}
          </button>
        </div>
      </div>
    </div>
  )
}
