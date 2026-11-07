import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface FormActionsProps {
  submitLabel?: string
  cancelLabel?: string
  onCancel?: () => void
  isSubmitting?: boolean
  submitDisabled?: boolean
  align?: 'start' | 'end' | 'between'
  /** Extra controls rendered before the cancel / submit buttons. */
  extra?: ReactNode
  /** Stick to the bottom of the viewport on mobile (static from `sm` up). */
  sticky?: boolean
  className?: string
}

const ALIGN_CLASSES: Record<NonNullable<FormActionsProps['align']>, string> = {
  start: 'sm:justify-start',
  end: 'sm:justify-end',
  between: 'sm:justify-between',
}

/** Submit / cancel row for forms. Buttons stack full-width on mobile. */
export function FormActions({
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  onCancel,
  isSubmitting = false,
  submitDisabled = false,
  align = 'end',
  extra,
  sticky = false,
  className,
}: FormActionsProps) {
  return (
    <div
      data-slot="form-actions"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:items-center',
        ALIGN_CLASSES[align],
        sticky &&
          'sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none',
        className,
      )}
    >
      {extra ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center">{extra}</div> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {cancelLabel}
          </Button>
        ) : null}
        <Button
          type="submit"
          disabled={isSubmitting || submitDisabled}
          aria-busy={isSubmitting || undefined}
        >
          {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
