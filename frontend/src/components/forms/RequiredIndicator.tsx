import { cn } from '@/lib/utils'

export interface RequiredIndicatorProps {
  className?: string
}

/** Visible asterisk plus screen-reader text for required fields. Sits tight against the label text (the label is a `gap-2` row). */
export function RequiredIndicator({ className }: RequiredIndicatorProps) {
  return (
    <span className={cn('-ml-1.5 text-destructive', className)}>
      <span aria-hidden="true">*</span>
      <span className="sr-only"> (required)</span>
    </span>
  )
}
