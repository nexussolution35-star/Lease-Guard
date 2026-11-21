import { cn } from '@/lib/utils'

export interface BrandMarkProps {
  /** Shows the mark without the wordmark (collapsed sidebar). */
  markOnly?: boolean
  /** Keeps the wordmark in place but faded out (the collapsing sidebar), so the mark never moves. */
  wordmarkHidden?: boolean
  className?: string
}

/**
 * The LeaseGuard mark and wordmark on one row. The mark is a flat monogram: an L ruled inside a
 * square, drawn in the text colour. Blue on light pages; on the ink-blue rail it takes the rail's
 * foreground so it reads at full contrast.
 */
export function BrandMark({ markOnly = false, wordmarkHidden = false, className }: BrandMarkProps) {
  return (
    <span className={cn('flex items-center gap-2 text-[15px] leading-none font-semibold', className)}>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5 shrink-0 text-primary [.rail_&]:text-foreground"
        aria-hidden="true"
      >
        <rect x="1.75" y="1.75" width="16.5" height="16.5" rx="4.25" />
        <path d="M7.5 5.75v8.5h5.25" strokeWidth="1.75" />
      </svg>
      {markOnly ? null : (
        <span translate="no" aria-hidden={wordmarkHidden || undefined} className={cn('whitespace-nowrap transition-opacity duration-200 ease-out motion-reduce:transition-none', wordmarkHidden && 'opacity-0')}>
          LeaseGuard
        </span>
      )}
    </span>
  )
}
