import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface DeleteIssueCleanupOptions {
  deleteWorktree?: boolean
  forceDelete?: boolean
  deleteBranch?: boolean
}

/**
 * Issue delete dialog with explicit worktree cleanup checkboxes, mirroring
 * AoE's DeleteSessionDialog: "Delete worktree" (default on), "Force delete"
 * (nested, uncommitted changes), "Delete branch" (default off). The cleanup
 * block only renders for issues that actually own a managed worktree.
 *
 * Mobile parity: the dialog and checkboxes use the same stacked layout at
 * every breakpoint (the underlying AlertDialog is responsive by default).
 */
export function DeleteIssueDialog({
  open,
  onOpenChange,
  issueTitle,
  hasWorktree,
  branchName,
  isPending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  issueTitle: string
  hasWorktree: boolean
  branchName: string | null
  isPending: boolean
  onConfirm: (cleanup: DeleteIssueCleanupOptions | undefined) => void
}) {
  const { t } = useTranslation()
  const [deleteWorktree, setDeleteWorktree] = useState(true)
  const [forceDelete, setForceDelete] = useState(false)
  const [deleteBranch, setDeleteBranch] = useState(false)

  // Reset to defaults whenever the dialog re-opens so a previous run's
  // choices don't leak into the next delete.
  useEffect(() => {
    if (open) {
      setDeleteWorktree(true)
      setForceDelete(false)
      setDeleteBranch(false)
    }
  }, [open])

  const handleConfirm = () => {
    onConfirm(
      hasWorktree
        ? { deleteWorktree, forceDelete, deleteBranch }
        : undefined,
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteIssue.title')}</AlertDialogTitle>
        </AlertDialogHeader>

        <p className="text-sm text-muted-foreground">
          {t('deleteIssue.confirm', { title: issueTitle })}
        </p>

        {hasWorktree
          ? (
              <div className="space-y-2 pt-1">
                <CleanupCheckbox
                  checked={deleteWorktree}
                  onChange={setDeleteWorktree}
                  label={t('deleteIssue.deleteWorktree')}
                  detail={branchName ? t('deleteIssue.deleteWorktreeDetail', { branch: branchName }) : undefined}
                  testId="delete-issue-checkbox-worktree"
                />
                {deleteWorktree
                  ? (
                      <div className="pl-6">
                        <CleanupCheckbox
                          checked={forceDelete}
                          onChange={setForceDelete}
                          label={t('deleteIssue.forceDelete')}
                          detail={t('deleteIssue.forceDeleteDetail')}
                          testId="delete-issue-checkbox-force"
                        />
                      </div>
                    )
                  : null}
                <CleanupCheckbox
                  checked={deleteBranch}
                  onChange={setDeleteBranch}
                  label={t('deleteIssue.deleteBranch')}
                  detail={branchName ? t('deleteIssue.deleteBranchDetail', { branch: branchName }) : undefined}
                  testId="delete-issue-checkbox-branch"
                />
              </div>
            )
          : null}

        <AlertDialogFooter>
          <Button variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={isPending} onClick={handleConfirm}>
            {isPending ? t('deleteIssue.deleting') : t('deleteIssue.delete')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CleanupCheckbox({
  checked,
  onChange,
  label,
  detail,
  testId,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  detail?: string
  testId?: string
}) {
  return (
    <label
      className="flex items-start gap-2.5 cursor-pointer"
      data-testid={testId}
      data-checked={checked ? 'true' : 'false'}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        aria-label={label}
        className="mt-0.5 size-4 shrink-0 accent-destructive cursor-pointer"
      />
      <span className="flex flex-col min-w-0">
        <span className="text-[13px] text-foreground">{label}</span>
        {detail ? <span className="text-[12px] text-muted-foreground">{detail}</span> : null}
      </span>
    </label>
  )
}
