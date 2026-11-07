import { AlertCircle, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ErrorStateProps {
  title?: string
  error: Error | string
  onRetry?: () => void
  className?: string
}

export function ErrorState({ title = 'Something went wrong', error, onRetry, className }: ErrorStateProps) {
  const message = typeof error === 'string' ? error : error.message
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-8 text-center',
        className,
      )}
    >
      <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
      <div className="max-w-md space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  )
}
