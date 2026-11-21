import { useId, type ReactNode } from 'react'

import { SETTINGS_ROW_GRID } from '@/components/forms'
import { cn } from '@/lib/utils'

export interface SettingsRowProps {
  title: string
  description?: string
  className?: string
  children: ReactNode
}

/** A read-only settings row with the geometry of `FormSection layout="row"`: heading on the left from `lg`, content on the right. */
export function SettingsRow({ title, description, className, children }: SettingsRowProps) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className={cn(SETTINGS_ROW_GRID, 'gap-y-4', className)}>
      <div className="space-y-1">
        <h2 id={titleId} className="text-sm font-medium text-balance text-foreground">
          {title}
        </h2>
        {description ? <p className="text-xs text-muted-foreground italic">{description}</p> : null}
      </div>
      <div className="max-w-xl">{children}</div>
    </section>
  )
}
