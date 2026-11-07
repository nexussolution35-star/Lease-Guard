import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import type { Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { AppLink } from './AppLink'
import { TONE_SOFT_CLASSES, TONE_TEXT_CLASSES } from './tone'

export interface MetricTrend {
  direction: 'up' | 'down' | 'flat'
  label: string
}

export interface MetricCardProps {
  label: string
  value: ReactNode
  description?: string
  icon?: LucideIcon
  tone?: Tone
  trend?: MetricTrend
  /** Makes the card a link. */
  href?: string
  /** Makes the card a button (ignored when `href` is set). */
  onClick?: () => void
  isLoading?: boolean
  className?: string
}

const TREND_ICONS: Readonly<Record<MetricTrend['direction'], LucideIcon>> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
}

const CARD_CLASSES =
  'flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left text-card-foreground shadow-xs'
const INTERACTIVE_CLASSES =
  'transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'

export function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone = 'neutral',
  trend,
  href,
  onClick,
  isLoading = false,
  className,
}: MetricCardProps) {
  const TrendIcon = trend ? TREND_ICONS[trend.direction] : null

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? (
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', TONE_SOFT_CLASSES[tone])}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {isLoading ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading {label}</span>
          <Skeleton className="h-7 w-24" />
        </div>
      ) : (
        <div className={cn('text-2xl font-semibold tracking-tight tabular-nums', tone !== 'neutral' && TONE_TEXT_CLASSES[tone])}>
          {value}
        </div>
      )}
      {description || trend ? (
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {trend && TrendIcon ? (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <TrendIcon className="size-3.5" aria-hidden="true" />
              {trend.label}
            </span>
          ) : null}
          {description ? <span>{description}</span> : null}
        </div>
      ) : null}
    </>
  )

  if (href) {
    return (
      <AppLink to={href} className={cn(CARD_CLASSES, INTERACTIVE_CLASSES, className)}>
        {body}
      </AppLink>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(CARD_CLASSES, INTERACTIVE_CLASSES, 'w-full', className)}>
        {body}
      </button>
    )
  }
  return <div className={cn(CARD_CLASSES, className)}>{body}</div>
}
