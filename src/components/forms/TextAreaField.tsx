import type { FieldPath, FieldValues } from 'react-hook-form'
import {
  FormControl,
  FormDescription,
  FormField as RHFFormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { fieldIdFor } from './fieldId'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps } from './types'

export interface TextAreaFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends BaseFieldProps<TFieldValues, TName> {
  placeholder?: string
  rows?: number
  maxLength?: number
  /** Show a "n / max" character counter (requires `maxLength`). */
  showCount?: boolean
}

export function TextAreaField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  description,
  required = false,
  disabled = false,
  id,
  className,
  placeholder,
  rows = 4,
  maxLength,
  showCount = false,
}: TextAreaFieldProps<TFieldValues, TName>) {
  const controlId = id ?? fieldIdFor(name)
  return (
    <RHFFormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = typeof field.value === 'string' ? field.value : ''
        return (
          <FormItem className={className}>
            <FormLabel htmlFor={controlId}>
              {label}
              {required ? <RequiredIndicator /> : null}
            </FormLabel>
            <FormControl id={controlId}>
              <Textarea
                {...field}
                value={value}
                rows={rows}
                placeholder={placeholder}
                maxLength={maxLength}
                disabled={disabled}
                aria-required={required || undefined}
              />
            </FormControl>
            {description || (showCount && maxLength) ? (
              <div className="flex items-start justify-between gap-2">
                {description ? <FormDescription>{description}</FormDescription> : <span />}
                {showCount && maxLength ? (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {value.length} / {maxLength}
                  </span>
                ) : null}
              </div>
            ) : null}
            <FormMessage role="alert" />
          </FormItem>
        )
      }}
    />
  )
}
