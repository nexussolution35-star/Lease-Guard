import { Loader2 } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface FormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Form fields. */
  children: ReactNode
  /** Default `Save`. */
  submitLabel?: string
  /** Called on submit. The dialog does NOT close itself; close it from the caller once saved. */
  onSubmit: () => void | Promise<void>
  isPending?: boolean
  submitDisabled?: boolean
  /** Default `md`. */
  size?: 'sm' | 'md' | 'lg'
  /** Default `Cancel`. */
  cancelLabel?: string
}

const SIZE_CLASSES: Readonly<Record<'sm' | 'md' | 'lg', string>> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  submitLabel = 'Save',
  onSubmit,
  isPending = false,
  submitDisabled = false,
  size = 'md',
  cancelLabel = 'Cancel',
}: FormDialogProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (isPending || submitDisabled) return
    void onSubmit()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (isPending ? undefined : onOpenChange(next))}>
      <DialogContent className={cn('flex max-h-[90vh] flex-col gap-0 p-0', SIZE_CLASSES[size])}>
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-4">{children}</div>
          <DialogFooter className="border-t border-border p-4 sm:px-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isPending}>
                {cancelLabel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isPending || submitDisabled}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
