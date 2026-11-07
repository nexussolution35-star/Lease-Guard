import { formatZAR } from '@/domain'
import { cn } from '@/lib/utils'

export interface CurrencyDisplayProps {
  amount: number | null | undefined
  /** `R 1,3 mil` style for dashboards. */
  compact?: boolean
  /** Prefix positive amounts with `+` and negative amounts with `−`. */
  signed?: boolean
  /** `auto` colours negative amounts destructive. Default `auto`. */
  tone?: 'auto' | 'none'
  className?: string
}

export function CurrencyDisplay({ amount, compact = false, signed = false, tone = 'auto', className }: CurrencyDisplayProps) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return (
      <span className={cn('tabular-nums text-muted-foreground', className)} aria-label="Not available">
        —
      </span>
    )
  }

  let text: string
  if (signed) {
    const sign = amount > 0 ? '+' : amount < 0 ? '−' : ''
    text = `${sign}${formatZAR(Math.abs(amount), { compact })}`
  } else {
    text = formatZAR(amount, { compact })
  }

  return (
    <data
      value={String(amount)}
      className={cn(
        'whitespace-nowrap tabular-nums',
        tone === 'auto' && amount < 0 && 'text-destructive',
        className,
      )}
    >
      {text}
    </data>
  )
}
