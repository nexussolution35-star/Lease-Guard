import { formatSADate } from '@leaseguard/domain'
import type { ISODate } from '@leaseguard/domain'

import { cn } from '@/lib/utils'

import { leaseTermScale, type TermLease } from '../leaseTermScale'

export interface LeaseTermBarsProps {
  leases: readonly TermLease[]
  today: ISODate
  className?: string
}

/**
 * Lease terms drawn to scale on one axis: each bar's length is the exact term, a tick marks the last day for
 * renewal notice, and a hairline marks today. The figures beside each bar carry the same facts as text.
 */
export function LeaseTermBars({ leases, today, className }: LeaseTermBarsProps) {
  const scale = leaseTermScale(leases, today)
  if (!scale) return null
  const hasNotice = scale.bars.some((bar) => bar.notice)

  return (
    <figure className={cn('space-y-3', className)}>
      <ol className="space-y-2">
        {scale.bars.map(({ lease, left, width, notice }) => (
          <li key={lease.id} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 sm:grid-cols-[6rem_minmax(0,1fr)_13rem]">
            <span className="truncate text-sm font-medium tabular-nums">{lease.reference}</span>
            <span className="relative h-5" aria-hidden="true">
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
              <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/45" style={{ left: `${left}%`, width: `${width}%` }} />
              {notice ? <span className="absolute top-0.5 h-4 w-0.5 rounded-full bg-warning" style={{ left: `${notice.at}%` }} /> : null}
              {scale.today === null ? null : <span className="absolute -top-0.5 h-6 w-px bg-foreground/60" style={{ left: `${scale.today}%` }} />}
            </span>
            <span className="col-start-2 text-xs text-muted-foreground tabular-nums sm:col-start-3 sm:text-right sm:text-sm">
              {formatSADate(lease.commencementDate)} – {formatSADate(lease.expiryDate)}
              {notice ? <span className="sr-only">. Renewal notice by {formatSADate(notice.date)}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[6rem_minmax(0,1fr)_13rem]" aria-hidden="true">
        <span className="relative col-start-2 h-4 text-xs text-muted-foreground tabular-nums">
          {scale.years.map(({ year, at }, index) => (
            <span
              key={year}
              // Narrow screens label about four years so the labels never collide; wide screens label every year.
              className={cn('absolute -translate-x-1/2', index % Math.max(1, Math.ceil(scale.years.length / 4)) !== 0 && 'hidden sm:inline')}
              style={{ left: `${at}%` }}
            >
              {year}
            </span>
          ))}
        </span>
      </div>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {hasNotice ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-warning" />
            Last day for renewal notice
          </span>
        ) : null}
        {scale.today === null ? null : (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-px bg-foreground/60" />
            Today, {formatSADate(today)}
          </span>
        )}
        <span>Drawn to scale, {scale.start.slice(0, 4)} to {scale.end.slice(0, 4)}</span>
      </figcaption>
    </figure>
  )
}
