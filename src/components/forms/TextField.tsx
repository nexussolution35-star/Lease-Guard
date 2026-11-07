import type { FieldPath, FieldValues } from 'react-hook-form'
import {
  FormControl,
  FormDescription,
  FormField as RHFFormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { fieldIdFor } from './fieldId'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps } from './types'

export interface TextFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends BaseFieldProps<TFieldValues, TName> {
  type?: 'text' | 'email' | 'url' | 'search' | 'password'
  placeholder?: string
  autoComplete?: string
  inputMode?: 'text' | 'email' | 'url' | 'search' | 'numeric' | 'decimal' | 'tel'
  maxLength?: number
}

export function TextField<
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
  type = 'text',
  placeholder,
  autoComplete,
  inputMode,
  maxLength,
}: TextFieldProps<TFieldValues, TName>) {
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
          <FormControl id={controlId}>
            <Input
              {...field}
              value={typeof field.value === 'string' ? field.value : ''}
              type={type}
              placeholder={placeholder}
              autoComplete={autoComplete}
              inputMode={inputMode}
              maxLength={maxLength}
              disabled={disabled}
              aria-required={required || undefined}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  )
}
