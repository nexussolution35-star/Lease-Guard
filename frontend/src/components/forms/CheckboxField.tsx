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
        <FormItem className={className}>
          {/* The label wraps the box and its text: one hit target with no dead gap between them. */}
          <FormLabel htmlFor={controlId} className="items-start gap-3 font-normal">
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
            <span>
              {label}
              {required ? <RequiredIndicator className="ml-0.5" /> : null}
            </span>
          </FormLabel>
          {description ? <FormDescription className="pl-7">{description}</FormDescription> : null}
          <FormMessage role="alert" className="pl-7" />
        </FormItem>
      )}
    />
  )
}
