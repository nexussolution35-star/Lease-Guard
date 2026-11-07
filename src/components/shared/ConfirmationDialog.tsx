import { Loader2 } from 'lucide-react'
import { useId, useState } from 'react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface ConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Default `Confirm`. */
  confirmLabel?: string
  /** Default `Cancel`. */
  cancelLabel?: string
  /** Style the confirm button as destructive. */
  destructive?: boolean
  /** Require a non-blank reason before confirming (passed to `onConfirm`). */
  requireReason?: boolean
  /** Default `Reason`. */
  reasonLabel?: string
  /**
   * Called with the trimmed reason (when `requireReason`). The dialog closes after it resolves;
   * if it throws, the dialog stays open.
   */
  onConfirm: (reason?: string) => void | Promise<void>
  isPending?: boolean
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  requireReason = false,
  reasonLabel = 'Reason',
  onConfirm,
  isPending = false,
}: ConfirmationDialogProps) {
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const busy = isPending || submitting
  const trimmed = reason.trim()
  const confirmDisabled = busy || (requireReason && trimmed === '')

  function handleOpenChange(next: boolean) {
    if (busy) return
    if (!next) setReason('')
    onOpenChange(next)
  }

  async function handleConfirm() {
    if (confirmDisabled) return
    setSubmitting(true)
    try {
      await onConfirm(requireReason ? trimmed : undefined)
      setReason('')
      onOpenChange(false)
    } catch {
      // Caller surfaces the error (e.g. toast); keep the dialog open so the user can retry.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {requireReason ? (
          <div className="space-y-2">
            <Label htmlFor={reasonId}>{reasonLabel}</Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              aria-required="true"
              disabled={busy}
              rows={3}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={confirmDisabled}
            onClick={() => void handleConfirm()}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
