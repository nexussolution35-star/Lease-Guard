import { cn } from '@/lib/utils'

export interface RequiredIndicatorProps {
  className?: string
}

/** Visible asterisk plus screen-reader text for required fields. */
export function RequiredIndicator({ className }: RequiredIndicatorProps) {
  return (
    <span className={cn('text-destructive', className)}>
      <span aria-hidden="true">*</span>
      <span className="sr-only"> (required)</span>
    </span>
  )
}
