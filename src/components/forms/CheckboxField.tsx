import type { FieldPath, FieldValues } from 'react-hook-form'
import { Checkbox } from '@/components/ui/checkbox'
import {
  FormControl,
  FormDescription,
  FormField as RHFFormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { cn } from '@/lib/utils'
import { fieldIdFor } from './fieldId'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps } from './types'

export type CheckboxFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> = BaseFieldProps<TFieldValues, TName>

/** Single boolean checkbox with label beside it. */
export function CheckboxField<
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
}: CheckboxFieldProps<TFieldValues, TName>) {
  const controlId = id ?? fieldIdFor(name)
  return (
    <RHFFormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn('flex flex-row items-start gap-3', className)}>
          <FormControl id={controlId}>
            <Checkbox
              ref={field.ref}
              name={field.name}
              checked={field.value === true}
              onCheckedChange={(checked) => field.onChange(checked === true)}
              onBlur={field.onBlur}
              disabled={disabled}
              aria-required={required || undefined}
              className="mt-0.5"
            />
          </FormControl>
          <div className="grid gap-1">
            <FormLabel htmlFor={controlId} className="font-normal">
              {label}
              {required ? <RequiredIndicator /> : null}
            </FormLabel>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage role="alert" />
          </div>
        </FormItem>
      )}
    />
  )
}
