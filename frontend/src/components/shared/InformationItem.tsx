import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { TooltipInfo } from './TooltipInfo'

export interface InformationItemProps {
  label: string
  value: ReactNode
  /** Short explanation shown in a tooltip next to the label. */
  hint?: string
  className?: string
}

export function InformationItem({ label, value, hint, className }: InformationItemProps) {
  const isEmpty = value === null || value === undefined || value === ''
  return (
    <div
      data-slot="information-item"
      className={cn(
        'grid min-w-0 gap-1',
        'group-data-[layout=inline]/information:grid-cols-[8rem_minmax(0,1fr)] group-data-[layout=inline]/information:items-baseline group-data-[layout=inline]/information:gap-x-4',
        className,
      )}
    >
      <dt className="flex items-center gap-1 text-xs text-muted-foreground group-data-[layout=inline]/information:text-sm">
        {label}
        {hint ? <TooltipInfo content={hint} label={`About ${label}`} /> : null}
      </dt>
      <dd className="text-sm break-words text-foreground">
        {isEmpty ? <span className="text-muted-foreground">—</span> : value}
      </dd>
    </div>
  )
}
