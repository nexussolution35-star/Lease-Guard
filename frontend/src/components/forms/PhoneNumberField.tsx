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
import { formatSAPhoneNumber, normaliseSAPhoneNumber } from './phone'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps, SlotA11yProps } from './types'

export interface PhoneNumberFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends BaseFieldProps<TFieldValues, TName> {
  placeholder?: string
}

interface PhoneInputProps extends SlotA11yProps {
  value: unknown
  onChange: (value: string) => void
  onBlur: () => void
  inputRef: (instance: HTMLInputElement | null) => void
  name: string
  placeholder?: string
  disabled: boolean
  required: boolean
}

function toDisplay(value: unknown): string {
  if (typeof value !== 'string') return ''
  return normaliseSAPhoneNumber(value) === value ? formatSAPhoneNumber(value) : value
}

/**
 * Stores E.164 (`+27821234567`) once valid and shows a stored E.164 value as `+27 82 123 4567`; text
 * being typed is shown as typed. The displayed text never changes on focus, so selecting the value
 * and typing over it replaces it.
 */
function PhoneInput({
  value,
  onChange,
  onBlur,
  inputRef,
  name,
  placeholder,
  disabled,
  required,
  ...slotProps
}: PhoneInputProps) {
  const raw = typeof value === 'string' ? value : ''
  return (
    <Input
      {...slotProps}
      ref={inputRef}
      name={name}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={toDisplay(value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-required={required || undefined}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => {
        const normalised = normaliseSAPhoneNumber(raw)
        if (normalised && normalised !== raw) onChange(normalised)
        onBlur()
      }}
    />
  )
}

export function PhoneNumberField<
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
  placeholder = '082 123 4567',
}: PhoneNumberFieldProps<TFieldValues, TName>) {
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
            <PhoneInput
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              placeholder={placeholder}
              disabled={disabled}
              required={required}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  )
}
