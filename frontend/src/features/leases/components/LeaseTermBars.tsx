import type { ISODate } from '@leaseguard/domain'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import { leaseTermScale, type TermLease } from '../leaseTermScale'
import { useDateFormatter } from '@/lib/dateFormat'

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
  const { date: formatDate } = useDateFormatter()
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
              {formatDate(lease.commencementDate)} – {formatDate(lease.expiryDate)}
              {notice ? <span className="sr-only">. Renewal notice by {formatDate(notice.date)}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 sm:grid-cols-[6rem_minmax(0,1fr)_13rem]" aria-hidden="true">
        <YearAxis years={scale.years} />
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
            Today, {formatDate(today)}
          </span>
        )}
        <span>Drawn to scale, {scale.start.slice(0, 4)} to {scale.end.slice(0, 4)}</span>
      </figcaption>
    </figure>
  )
}

/** Least room one year label needs (four tabular digits at text-xs plus a gap). */
const LABEL_SPACE_PX = 44

/**
 * The year labels under the bars. How many fit is measured from the axis's own width (ResizeObserver), so labels
 * never overlap at any width, with the details panel open or not; labels near either end are kept inside the axis
 * rather than centred over its edge.
 */
function YearAxis({ years }: { years: readonly { year: number; at: number }[] }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Before the first measurement, label about four years; afterwards as many as the width allows.
  const fit = width > 0 ? Math.max(1, Math.floor(width / LABEL_SPACE_PX)) : 4
  const step = Math.max(1, Math.ceil(years.length / fit))

  return (
    <span ref={ref} className="relative col-start-2 h-4 text-xs text-muted-foreground tabular-nums">
      {years.map(({ year, at }, index) =>
        index % step === 0 ? (
          <span
            key={year}
            className={cn('absolute whitespace-nowrap', at < 6 ? 'translate-x-0' : at > 94 ? '-translate-x-full' : '-translate-x-1/2')}
            style={{ left: `${at}%` }}
          >
            {year}
          </span>
        ) : null,
      )}
    </span>
  )
}
