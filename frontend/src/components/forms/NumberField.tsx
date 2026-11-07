import { useState } from 'react'
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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { fieldIdFor } from './fieldId'
import { parseNumberInput } from './numberInput'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps, SlotA11yProps } from './types'

export interface NumberFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends BaseFieldProps<TFieldValues, TName> {
  placeholder?: string
  min?: number
  max?: number
  step?: number
  /** Unit shown after the input, e.g. "%", "months", "m²". */
  suffix?: string
  /** Allow a decimal point (default true). */
  allowDecimal?: boolean
}

interface NumberInputProps extends SlotA11yProps {
  value: unknown
  onChange: (value: number | undefined) => void
  onBlur: () => void
  inputRef: (instance: HTMLInputElement | null) => void
  name: string
  placeholder?: string
  min?: number
  max?: number
  step?: number
  allowDecimal: boolean
  disabled: boolean
  required: boolean
}

function toText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

/** Text input (inputMode numeric/decimal) so partial input like "7," is never lost. */
function NumberInput({
  value,
  onChange,
  onBlur,
  inputRef,
  name,
  placeholder,
  min,
  max,
  step,
  allowDecimal,
  disabled,
  required,
  ...slotProps
}: NumberInputProps) {
  const [text, setText] = useState<string | null>(null)
  const display = text ?? toText(value)
  return (
    <InputGroupInput
      {...slotProps}
      ref={inputRef}
      name={name}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={display}
      placeholder={placeholder}
      disabled={disabled}
      aria-required={required || undefined}
      role="spinbutton"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={typeof value === 'number' && Number.isFinite(value) ? value : undefined}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        const current = typeof value === 'number' && Number.isFinite(value) ? value : (min ?? 0)
        const delta = (step ?? 1) * (event.key === 'ArrowUp' ? 1 : -1)
        let next = Number((current + delta).toFixed(10))
        if (min !== undefined) next = Math.max(min, next)
        if (max !== undefined) next = Math.min(max, next)
        setText(String(next))
        onChange(next)
      }}
      onFocus={() => setText(toText(value))}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        const parsed = parseNumberInput(next)
        onChange(parsed !== undefined && !allowDecimal ? Math.trunc(parsed) : parsed)
      }}
      onBlur={() => {
        setText(null)
        onBlur()
      }}
    />
  )
}

export function NumberField<
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
  min,
  max,
  step,
  suffix,
  allowDecimal = true,
}: NumberFieldProps<TFieldValues, TName>) {
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
          <InputGroup data-disabled={disabled || undefined}>
            <FormControl id={controlId}>
              <NumberInput
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                name={field.name}
                placeholder={placeholder}
                min={min}
                max={max}
                step={step}
                allowDecimal={allowDecimal}
                disabled={disabled}
                required={required}
              />
            </FormControl>
            {suffix ? (
              <InputGroupAddon align="inline-end">
                <InputGroupText>{suffix}</InputGroupText>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  )
}
