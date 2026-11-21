import { AlertCircle, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ErrorStateProps {
  title?: string
  error: Error | string
  onRetry?: () => void
  /** Pass `border-0` when it sits inside another frame (a table, a card). */
  className?: string
}

export function ErrorState({ title = 'Something went wrong', error, onRetry, className }: ErrorStateProps) {
  const message = typeof error === 'string' ? error : error.message
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-border px-4 py-3 text-sm',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-foreground">{title}</p>
        {message ? <p className="break-words text-foreground">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="ml-auto">
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  )
}
