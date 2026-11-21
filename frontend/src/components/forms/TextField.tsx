import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { fieldIdFor } from './fieldId'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps } from './types'

export interface TextFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends BaseFieldProps<TFieldValues, TName> {
  type?: 'text' | 'email' | 'url' | 'search' | 'password' | 'tel'
  placeholder?: string
  autoComplete?: string
  inputMode?: 'text' | 'email' | 'url' | 'search' | 'numeric' | 'decimal' | 'tel'
  maxLength?: number
  /** With `type="password"`: adds a Show password toggle on the right of the input. */
  revealable?: boolean
  /**
   * The value is a code or reference (property code, lease reference, unit number, registration or VAT
   * number), not prose: no autocapitalise, autocorrect or spellcheck, so mobile keyboards keep it exactly
   * as printed on leases and statements.
   */
  identifier?: boolean
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
  revealable = false,
  identifier = false,
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
          {type === 'password' && revealable ? (
            <RevealablePasswordInput
              controlId={controlId}
              field={field}
              autoComplete={autoComplete}
              placeholder={placeholder}
              maxLength={maxLength}
              disabled={disabled}
              required={required}
            />
          ) : (
            <FormControl id={controlId}>
              <Input
                {...field}
                value={typeof field.value === 'string' ? field.value : ''}
                type={type}
                placeholder={placeholder}
                autoComplete={autoComplete}
                inputMode={inputMode}
                spellCheck={identifier || type === 'email' || type === 'url' || type === 'password' ? false : undefined}
                autoCapitalize={identifier ? 'none' : undefined}
                autoCorrect={identifier ? 'off' : undefined}
                maxLength={maxLength}
                disabled={disabled}
                aria-required={required || undefined}
              />
            </FormControl>
          )}
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage role="alert" />
        </FormItem>
      )}
    />
  )
}

interface RevealablePasswordInputProps {
  controlId: string
  field: {
    name: string
    value: unknown
    onChange: (...event: unknown[]) => void
    onBlur: () => void
    ref: (instance: HTMLInputElement | null) => void
  }
  autoComplete?: string
  placeholder?: string
  maxLength?: number
  disabled: boolean
  required: boolean
}

/**
 * A password input with a Show password toggle. The input goes back to type="password" before the
 * form submits, so the browser still recognises it as a password and offers to save it.
 */
function RevealablePasswordInput({
  controlId,
  field,
  autoComplete,
  placeholder,
  maxLength,
  disabled,
  required,
}: RevealablePasswordInputProps) {
  const [revealed, setRevealed] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const form = inputRef.current?.form
    if (!form) return
    const hide = () => flushSync(() => setRevealed(false))
    form.addEventListener('submit', hide, { capture: true })
    return () => form.removeEventListener('submit', hide, { capture: true })
  }, [])

  return (
    <InputGroup data-disabled={disabled || undefined}>
      <FormControl id={controlId}>
        <InputGroupInput
          name={field.name}
          value={typeof field.value === 'string' ? field.value : ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          ref={(instance) => {
            inputRef.current = instance
            field.ref(instance)
          }}
          type={revealed ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="off"
          maxLength={maxLength}
          disabled={disabled}
          aria-required={required || undefined}
        />
      </FormControl>
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label="Show password"
          aria-pressed={revealed}
          aria-controls={controlId}
          disabled={disabled}
          // Keep focus (and the caret) in the input while toggling.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
