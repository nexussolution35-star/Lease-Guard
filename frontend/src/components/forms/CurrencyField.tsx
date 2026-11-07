import { useState } from 'react'
import type { FieldPath, FieldValues } from 'react-hook-form'
import {
  FormControl,
  FormDescription,
  FormField as RHFFormField,
  FormItem,
  FormLabel,
  useFormField,
} from '@/components/ui/form'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { formatZAR, parseZAR, roundZar } from '@leaseguard/domain'
import { FieldMessage } from './FieldMessage'
import { fieldIdFor } from './fieldId'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps, SlotA11yProps } from './types'

export interface CurrencyFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends BaseFieldProps<TFieldValues, TName> {
  placeholder?: string
  /** Allow amounts below zero (credits). Default false. */
  allowNegative?: boolean
}

const INVALID_MESSAGE = 'Enter a valid rand amount, e.g. 35 000,00'
const NEGATIVE_MESSAGE = 'Amount cannot be negative'

interface CurrencyInputProps extends SlotA11yProps {
  value: unknown
  onChange: (value: number | undefined) => void
  onBlur: () => void
  inputRef: (instance: HTMLInputElement | null) => void
  name: string
  placeholder?: string
  allowNegative: boolean
  disabled: boolean
  required: boolean
  invalid: boolean
  onInvalid: (message: string | null) => void
}

function formatAmount(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatZAR(value, { withSymbol: false })
    : ''
}

/**
 * Free-text rand input. While focused the user's text is kept as typed; on blur it is parsed
 * with `parseZAR`, stored as a 2dp number and re-displayed with `formatZAR` (no symbol — the
 * "R" is the visual prefix). Unparseable or disallowed input is kept visible with an error and
 * the stored value is cleared, so nothing is silently guessed.
 */
function CurrencyInput({
  value,
  onChange,
  onBlur,
  inputRef,
  name,
  placeholder,
  allowNegative,
  disabled,
  required,
  invalid,
  onInvalid,
  ...slotProps
}: CurrencyInputProps) {
  const [text, setText] = useState<string | null>(null)
  const { formMessageId } = useFormField()
  const display = text ?? formatAmount(value)
  const describedBy = slotProps['aria-describedby'] ?? ''
  const ariaDescribedBy =
    invalid && !describedBy.includes(formMessageId)
      ? `${describedBy} ${formMessageId}`.trim()
      : describedBy || undefined

  return (
    <InputGroupInput
      {...slotProps}
      ref={inputRef}
      name={name}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={display}
      placeholder={placeholder}
      disabled={disabled}
      aria-required={required || undefined}
      aria-invalid={invalid || slotProps['aria-invalid']}
      aria-describedby={ariaDescribedBy}
      onFocus={() => {
        if (text === null) setText(formatAmount(value))
      }}
      onChange={(event) => {
        setText(event.target.value)
        onInvalid(null)
      }}
      onBlur={() => {
        const raw = (text ?? '').trim()
        if (raw === '') {
          setText(null)
          onChange(undefined)
        } else {
          const parsed = parseZAR(raw)
          if (parsed === null) {
            onChange(undefined)
            onInvalid(INVALID_MESSAGE)
          } else if (parsed < 0 && !allowNegative) {
            onChange(undefined)
            onInvalid(NEGATIVE_MESSAGE)
          } else {
            setText(null)
            onChange(roundZar(parsed))
          }
        }
        onBlur()
      }}
    />
  )
}

export function CurrencyField<
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
  placeholder = '0,00',
  allowNegative = false,
}: CurrencyFieldProps<TFieldValues, TName>) {
  const controlId = id ?? fieldIdFor(name)
  const [localError, setLocalError] = useState<string | null>(null)
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
            <InputGroupAddon align="inline-start">
              <InputGroupText aria-hidden="true">R</InputGroupText>
            </InputGroupAddon>
            <FormControl id={controlId}>
              <CurrencyInput
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                name={field.name}
                placeholder={placeholder}
                allowNegative={allowNegative}
                disabled={disabled}
                required={required}
                invalid={localError !== null}
                onInvalid={setLocalError}
              />
            </FormControl>
          </InputGroup>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FieldMessage override={localError} />
        </FormItem>
      )}
    />
  )
}
