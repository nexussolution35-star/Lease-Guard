import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import type { Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'

import { AppLink } from './AppLink'
import { TONE_SOLID_CLASSES, TONE_TEXT_CLASSES } from './tone'

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
  /** The figure that matters on this screen: set larger, so hierarchy comes from scale. One per strip. */
  lead?: boolean
  className?: string
}

const TREND_ICONS: Readonly<Record<MetricTrend['direction'], LucideIcon>> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
}

/** A flat cell of the `MetricGrid` stat strip; the grid draws the frame and the hairlines. */
// Each cell is its own size container, so its figure scales with the cell's width (cqi), never the viewport: a long
// amount in a narrow strip shrinks to fit instead of running under the next cell. The caps keep today's sizes.
const CARD_CLASSES = 'flex h-full min-w-0 flex-col gap-2 bg-card px-5 py-4 text-left text-card-foreground [container-type:inline-size]'
const INTERACTIVE_CLASSES =
  'transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden focus-visible:ring-inset'

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
  lead = false,
  className,
}: MetricCardProps) {
  const TrendIcon = trend ? TREND_ICONS[trend.direction] : null
  // Only a non-zero danger figure is coloured (warning on white is too faint to read); other tones show as a dot.
  const alarming = tone === 'danger' && value !== 0 && value !== '0'

  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {tone === 'neutral' ? null : <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', TONE_SOLID_CLASSES[tone])} />}
          {label}
        </p>
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
      </div>
      {isLoading ? (
        <div role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading {label}…</span>
          <Skeleton className={lead ? 'h-[2.625rem] w-20' : 'h-6 w-16'} />
        </div>
      ) : (
        <div className={cn('whitespace-nowrap', lead ? 'text-[clamp(1rem,14cqi,2.625rem)] leading-none font-semibold tracking-[-0.02em] tabular-nums' : 'text-[clamp(0.9375rem,12cqi,1.5rem)] leading-none font-medium tabular-nums', alarming ? TONE_TEXT_CLASSES[tone] : 'text-foreground')}>
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
      <AppLink to={href} data-lead={lead || undefined} className={cn(CARD_CLASSES, INTERACTIVE_CLASSES, className)}>
        {body}
      </AppLink>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} data-lead={lead || undefined} className={cn(CARD_CLASSES, INTERACTIVE_CLASSES, 'w-full', className)}>
        {body}
      </button>
    )
  }
  return (
    <div data-lead={lead || undefined} className={cn(CARD_CLASSES, className)}>
      {body}
    </div>
  )
}
