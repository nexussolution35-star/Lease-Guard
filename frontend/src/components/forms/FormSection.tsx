import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface FormSectionProps {
  title: string
  description?: string
  /** Grid columns from `sm` upward (default 2). Children can use `sm:col-span-2` to span. */
  columns?: 1 | 2
  children: ReactNode
  className?: string
}

/** Fieldset with legend and a responsive one/two column grid of fields. */
export function FormSection({
  title,
  description,
  columns = 2,
  children,
  className,
}: FormSectionProps) {
  return (
    <fieldset
      data-slot="form-section"
      className={cn('min-w-0 space-y-4 border-0 p-0', className)}
    >
      <legend className="text-base font-semibold text-foreground">{title}</legend>
      {description ? <p className="-mt-2 text-xs text-muted-foreground italic">{description}</p> : null}
      <div className={cn('grid gap-4', columns === 2 && 'sm:grid-cols-2')}>{children}</div>
    </fieldset>
  )
}
