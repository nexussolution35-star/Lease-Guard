import type { FieldPath, FieldValues } from 'react-hook-form'
import {
  FormControl,
  FormDescription,
  FormField as RHFFormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fieldIdFor } from './fieldId'
import type { FieldOption } from './options'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps } from './types'

export interface SelectFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  T extends string = string,
> extends BaseFieldProps<TFieldValues, TName> {
  /** Use `enumOptions(...)` from `@/lib/labels` for enum values. */
  options: readonly FieldOption<T>[]
  placeholder?: string
}

export function SelectField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  T extends string = string,
>({
  control,
  name,
  label,
  description,
  required = false,
  disabled = false,
  id,
  className,
  options,
  placeholder = 'Select…',
}: SelectFieldProps<TFieldValues, TName, T>) {
  const controlId = id ?? fieldIdFor(name)
  return (
    <RHFFormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel htmlFor={controlId}>
            {label}
            {required ? <RequiredIndicator /> : null}
          </FormLabel>
          <Select
            name={field.name}
            value={typeof field.value === 'string' ? field.value : ''}
            onValueChange={(next) => field.onChange(next as T)}
            onOpenChange={(open) => {
              if (!open) field.onBlur()
            }}
            disabled={disabled}
          >
            <FormControl id={controlId}>
              <SelectTrigger
                ref={field.ref}
                className="w-full"
                aria-required={required || undefined}
              >
                <SelectValue placeholder={placeholder} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  )
}
