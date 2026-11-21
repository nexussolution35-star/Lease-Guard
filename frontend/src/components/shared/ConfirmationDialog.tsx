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
import { describeApiError } from '@/lib/data/apiErrors'

/** Shown in the dialog when `onConfirm` throws something without a user-facing message. */
const FAILED_FALLBACK = 'Try again in a moment.'

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
   * if it throws, the dialog stays open (and, with `showError`, says why inside it).
   */
  onConfirm: (reason?: string) => void | Promise<void>
  isPending?: boolean
  /**
   * Show why `onConfirm` failed inside the dialog, as an alert. A toast raised while the modal is open sits
   * behind the backdrop and outside what screen readers can reach, so prefer this over a toast (and drop
   * the caller's toast to avoid saying it twice).
   */
  showError?: boolean
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
  showError = false,
}: ConfirmationDialogProps) {
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const busy = isPending || submitting
  const trimmed = reason.trim()
  const confirmDisabled = busy || (requireReason && trimmed === '')

  function handleOpenChange(next: boolean) {
    if (busy) return
    if (!next) {
      setReason('')
      setFailure(null)
    }
    onOpenChange(next)
  }

  async function handleConfirm() {
    if (confirmDisabled) return
    setSubmitting(true)
    setFailure(null)
    try {
      await onConfirm(requireReason ? trimmed : undefined)
      setReason('')
      onOpenChange(false)
    } catch (error) {
      // Keep the dialog open so the user can retry, and say why inside it.
      setFailure(describeApiError(error, FAILED_FALLBACK))
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
        {showError && failure ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
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
