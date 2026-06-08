import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useCleanWorktree, useRecreateWorktree } from '@/hooks/use-kanban'
import { ApiError } from '@/lib/kanban-api'

type CleanupTrigger = 'manual' | 'done' | 'merged'

/**
 * Shared worktree-lifecycle dialogs + imperative controller (PLAN-038 P2).
 *
 * Owns two dialogs reused by every trigger:
 * - cleanup confirm (manual button / done-offer / merge-offer), with the
 *   409 `worktree_dirty` dirty-warning + force escalation from the prototype.
 * - recreate confirm (the explicit "no silent op" gate before acting on a
 *   `cleaned` issue), which runs the caller's original action on success.
 *
 * Usage: spread the returned `dialogs` into the tree, then call
 * `offerCleanup(trigger)` or `gateRecreate(onProceed)`. All copy is i18n;
 * the AlertDialog is responsive so the flow works on the mobile layout too.
 */
export function useWorktreeLifecycle(projectId: string | undefined, issueId: string | undefined) {
  const { t } = useTranslation()
  const clean = useCleanWorktree(projectId ?? '')
  const recreate = useRecreateWorktree(projectId ?? '')

  // cleanup dialog state
  const [cleanOpen, setCleanOpen] = useState(false)
  const [trigger, setTrigger] = useState<CleanupTrigger>('manual')
  const [dirty, setDirty] = useState(false)
  const [force, setForce] = useState(false)

  // recreate dialog state
  const [recreateOpen, setRecreateOpen] = useState(false)
  const [onProceed, setOnProceed] = useState<(() => void) | null>(null)

  const offerCleanup = useCallback((next: CleanupTrigger = 'manual') => {
    if (!projectId || !issueId) return
    setTrigger(next)
    setDirty(false)
    setForce(false)
    setCleanOpen(true)
  }, [projectId, issueId])

  const gateRecreate = useCallback((proceed: () => void) => {
    if (!projectId || !issueId) return
    // store the callback in state (wrapped so React doesn't call it as an updater)
    setOnProceed(() => proceed)
    setRecreateOpen(true)
  }, [projectId, issueId])

  const handleClean = useCallback(async () => {
    if (!issueId) return
    try {
      await clean.mutateAsync({ issueId, force })
      toast.success(t('worktree.cleanup.success'))
      setCleanOpen(false)
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409 && err.message === 'worktree_dirty') {
        // Escalate the dialog into the dirty-warning state (keep it open).
        setDirty(true)
        setForce(false)
        return
      }
      toast.error(t('worktree.cleanup.error'))
    }
  }, [clean, issueId, force, t])

  const handleRecreate = useCallback(async () => {
    if (!issueId) return
    try {
      await recreate.mutateAsync({ issueId })
      toast.success(t('worktree.recreate.success'))
      setRecreateOpen(false)
      const cb = onProceed
      setOnProceed(null)
      cb?.()
    } catch {
      toast.error(t('worktree.recreate.error'))
    }
  }, [recreate, issueId, onProceed, t])

  const cleanupTitle = trigger === 'merged'
    ? t('worktree.cleanup.titleMerged')
    : trigger === 'done'
      ? t('worktree.cleanup.titleDone')
      : t('worktree.cleanup.title')

  const dialogs = (
    <>
      <AlertDialog open={cleanOpen} onOpenChange={open => !clean.isPending && setCleanOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{cleanupTitle}</AlertDialogTitle>
          </AlertDialogHeader>

          <p className="text-sm text-muted-foreground">{t('worktree.cleanup.body')}</p>

          {dirty
            ? (
                <div className="space-y-2 pt-1">
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-600 dark:text-amber-400">
                    {`⚠ ${t('worktree.cleanup.dirtyWarn')}`}
                  </div>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={e => setForce(e.target.checked)}
                      aria-label={t('worktree.cleanup.force')}
                      className="mt-0.5 size-4 shrink-0 accent-destructive cursor-pointer"
                    />
                    <span className="text-[13px] text-foreground">{t('worktree.cleanup.force')}</span>
                  </label>
                </div>
              )
            : null}

          <AlertDialogFooter>
            <Button variant="outline" disabled={clean.isPending} onClick={() => setCleanOpen(false)}>
              {t('worktree.cleanup.cancel')}
            </Button>
            <Button
              variant={dirty ? 'destructive' : 'default'}
              disabled={clean.isPending || (dirty && !force)}
              onClick={handleClean}
            >
              {t('worktree.cleanup.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={recreateOpen}
        onOpenChange={(open) => {
          if (recreate.isPending) return
          setRecreateOpen(open)
          if (!open) setOnProceed(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('worktree.recreate.title')}</AlertDialogTitle>
          </AlertDialogHeader>

          <p className="text-sm text-muted-foreground">{t('worktree.recreate.body')}</p>
          <p className="text-[12px] text-muted-foreground/80">{t('worktree.recreate.hint')}</p>

          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={recreate.isPending}
              onClick={() => {
                setRecreateOpen(false); setOnProceed(null)
              }}
            >
              {t('worktree.recreate.cancel')}
            </Button>
            <Button disabled={recreate.isPending} onClick={handleRecreate}>
              {t('worktree.recreate.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return { dialogs, offerCleanup, gateRecreate }
}
