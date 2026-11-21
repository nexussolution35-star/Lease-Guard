import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

import { SETTINGS_ROW_CONTENT, SETTINGS_ROW_LABEL } from './settingsRow'

export interface FormSectionProps {
  title: string
  description?: string
  /** Grid columns from `sm` upward (default 2). Children can use `sm:col-span-2` to span. */
  columns?: 1 | 2
  /** `row` is a settings row from `lg`: legend and description in a 14rem left column, fields on the right. */
  layout?: 'stacked' | 'row'
  children: ReactNode
  className?: string
}

/**
 * Fieldset with legend and a responsive one/two column grid of fields. Consecutive sections are separated by a
 * hairline. The legend is floated so the fieldset's top border is a plain line (an in-flow legend sits on the
 * border) and so it can stand beside the fields in the `row` layout; a legend cannot be a grid item.
 */
export function FormSection({
  title,
  description,
  columns = 2,
  layout = 'stacked',
  children,
  className,
}: FormSectionProps) {
  const row = layout === 'row'
  return (
    <fieldset
      data-slot="form-section"
      className={cn('min-w-0 border-0 p-0 [&+&]:border-t [&+&]:border-border [&+&]:pt-6', className)}
    >
      <legend className={cn('float-left w-full text-[0.9375rem] leading-6 font-medium text-balance text-foreground', row && SETTINGS_ROW_LABEL)}>
        {title}
      </legend>
      {description ? (
        <p className={cn('clear-left pt-1 text-xs text-muted-foreground italic', row && ['lg:float-left', SETTINGS_ROW_LABEL])}>
          {description}
        </p>
      ) : null}
      <div
        className={cn(
          'clear-left grid gap-4 pt-4',
          columns === 2 && 'sm:grid-cols-2',
          // Beside the label column the fields are too narrow for two columns until `xl`: every field takes the full row.
          row && ['max-w-xl lg:clear-none lg:pt-0 lg:max-xl:*:col-span-full', SETTINGS_ROW_CONTENT],
        )}
      >
        {children}
      </div>
    </fieldset>
  )
}
