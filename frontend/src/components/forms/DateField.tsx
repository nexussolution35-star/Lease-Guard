import { useId, useState } from 'react'
import type { FieldPath, FieldValues } from 'react-hook-form'
import { CalendarIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  FormControl,
  FormDescription,
  FormField as RHFFormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatSADate, isValidISODate, parseISODate, toISODate } from '@leaseguard/domain'
import { cn } from '@/lib/utils'
import type { ISODate } from '@leaseguard/domain'
import { fieldIdFor } from './fieldId'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps, SlotA11yProps } from './types'

export interface DateFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> extends BaseFieldProps<TFieldValues, TName> {
  placeholder?: string
  /** Earliest selectable date (inclusive). */
  min?: ISODate
  /** Latest selectable date (inclusive). */
  max?: ISODate
  /** Show a clear button when a value is set (default true). */
  clearable?: boolean
}

interface DatePickerProps extends SlotA11yProps {
  value: unknown
  onChange: (value: ISODate | undefined) => void
  onBlur: () => void
  inputRef: (instance: HTMLButtonElement | null) => void
  name: string
  label: string
  labelId: string
  placeholder: string
  min?: ISODate
  max?: ISODate
  clearable: boolean
  disabled: boolean
  required: boolean
}

function DatePicker({
  value,
  onChange,
  onBlur,
  inputRef,
  name,
  label,
  labelId,
  placeholder,
  min,
  max,
  clearable,
  disabled,
  required,
  ...slotProps
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const valueId = useId()
  const iso = typeof value === 'string' && isValidISODate(value) ? value : undefined
  const selected = iso ? parseISODate(iso) : undefined
  const minDate = min && isValidISODate(min) ? parseISODate(min) : undefined
  const maxDate = max && isValidISODate(max) ? parseISODate(max) : undefined
  const disabledMatchers = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ]

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onBlur()
        }}
      >
        <PopoverTrigger asChild>
          <Button
            {...slotProps}
            ref={inputRef}
            name={name}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-labelledby={`${labelId} ${valueId}`}
            aria-required={required || undefined}
            aria-haspopup="dialog"
            className={cn(
              'w-full justify-start gap-2 font-normal',
              !iso && 'text-muted-foreground',
            )}
          >
            <CalendarIcon className="size-4" aria-hidden="true" />
            <span id={valueId}>{iso ? formatSADate(iso, 'short') : placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? minDate}
            onSelect={(date: Date | undefined) => {
              onChange(date ? toISODate(date) : undefined)
              setOpen(false)
              onBlur()
            }}
            disabled={disabledMatchers}
            startMonth={minDate}
            endMonth={maxDate}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {clearable && iso && !disabled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Clear ${label}`}
          onClick={() => {
            onChange(undefined)
            onBlur()
          }}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}

/** Calendar date picker storing an ISODate (`YYYY-MM-DD`), displayed as `06 Nov 2026`. */
export function DateField<
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
  placeholder = 'Select a date',
  min,
  max,
  clearable = true,
}: DateFieldProps<TFieldValues, TName>) {
  const controlId = id ?? fieldIdFor(name)
  const labelId = `${controlId}-label`
  return (
    <RHFFormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel id={labelId} htmlFor={controlId}>
            {label}
            {required ? <RequiredIndicator /> : null}
          </FormLabel>
          <FormControl id={controlId}>
            <DatePicker
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              label={label}
              labelId={labelId}
              placeholder={placeholder}
              min={min}
              max={max}
              clearable={clearable}
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
