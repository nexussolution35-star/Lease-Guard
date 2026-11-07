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
    <div className={cn('min-w-0 space-y-1', className)}>
      <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {hint ? <TooltipInfo content={hint} label={`About ${label}`} /> : null}
      </dt>
      <dd className="text-sm break-words text-foreground">
        {isEmpty ? <span className="text-muted-foreground">—</span> : value}
      </dd>
    </div>
  )
}
