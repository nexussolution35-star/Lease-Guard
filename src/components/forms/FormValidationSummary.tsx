import { useId } from 'react'
import type { MouseEvent } from 'react'
import type { FieldErrors, FieldValues } from 'react-hook-form'
import { AlertCircle } from 'lucide-react'
import { labelFor } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { fieldIdFor } from './fieldId'
import { flattenErrors } from './flattenErrors'

export interface FormValidationSummaryProps {
  errors: FieldErrors<FieldValues> | Record<string, string>
  /** Display labels keyed by dotted path, e.g. `{ 'escalation.percentage': 'Escalation %' }`. */
  fieldLabels?: Record<string, string>
  title?: string
  className?: string
}

function fallbackLabel(path: string): string {
  const last = path.split('.').filter((p) => !/^\d+$/.test(p)).pop() ?? path
  return labelFor(last.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase())
}

/** Error list (role="alert") linking each message to its field. Renders nothing when valid. */
export function FormValidationSummary({
  errors,
  fieldLabels,
  title = 'Please correct the following:',
  className,
}: FormValidationSummaryProps) {
  const titleId = useId()
  const items = flattenErrors(errors)
  if (items.length === 0) return null

  const focusField = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    const target = document.getElementById(fieldIdFor(path))
    if (!target) return
    event.preventDefault()
    target.scrollIntoView?.({ block: 'center' })
    target.focus()
  }

  return (
    <div
      role="alert"
      aria-labelledby={titleId}
      data-slot="form-validation-summary"
      className={cn(
        'rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive',
        className,
      )}
    >
      <p id={titleId} className="flex items-center gap-2 font-medium">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        {items.map(({ path, message }) => {
          const fieldLabel = path === 'root' ? null : (fieldLabels?.[path] ?? fallbackLabel(path))
          return (
            <li key={`${path}:${message}`}>
              {path === 'root' ? (
                message
              ) : (
                <a
                  href={`#${fieldIdFor(path)}`}
                  onClick={(event) => focusField(event, path)}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  {fieldLabel}: {message}
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
