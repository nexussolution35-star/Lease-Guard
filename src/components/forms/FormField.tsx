import { cloneElement, isValidElement, useId } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { RequiredIndicator } from './RequiredIndicator'

export interface FormFieldProps {
  label: string
  /** Id of the control. Generated when omitted and injected into a single child element. */
  htmlFor?: string
  required?: boolean
  description?: string
  error?: string
  children: ReactNode
  className?: string
}

interface ControlA11yProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'aria-required'?: boolean
}

/**
 * Layout wrapper for a labelled control outside react-hook-form. Wires label, required
 * indicator, description and error (role="alert") to a single child control via
 * `id` / `aria-describedby` / `aria-invalid` / `aria-required`.
 */
export function FormField({
  label,
  htmlFor,
  required = false,
  description,
  error,
  children,
  className,
}: FormFieldProps) {
  const generatedId = useId()
  const controlId = htmlFor ?? `${generatedId}-control`
  const descriptionId = `${controlId}-description`
  const errorId = `${controlId}-error`
  const describedBy = [description ? descriptionId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')

  const control = isValidElement<ControlA11yProps>(children)
    ? cloneElement(children as ReactElement<ControlA11yProps>, {
        id: children.props.id ?? controlId,
        'aria-describedby':
          [children.props['aria-describedby'], describedBy].filter(Boolean).join(' ') ||
          undefined,
        'aria-invalid': error ? true : children.props['aria-invalid'],
        'aria-required': required || children.props['aria-required'] || undefined,
      })
    : children

  return (
    <div data-slot="form-field" className={cn('grid gap-2', className)}>
      <Label htmlFor={controlId} data-error={!!error} className="data-[error=true]:text-destructive">
        {label}
        {required ? <RequiredIndicator /> : null}
      </Label>
      {control}
      {description ? (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
