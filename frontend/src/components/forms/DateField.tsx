import { useId, useState } from 'react'
import type { FieldPath, FieldValues } from 'react-hook-form'
import { CalendarIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { inputClassName } from '@/components/ui/input'
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
import { isValidISODate, parseISODate, toISODate } from '@leaseguard/domain'
import { useDateFormatter } from '@/lib/dateFormat'
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
  /**
   * Month and year dropdowns in the calendar, for dates years away (lease terms, guarantees). The years run from `min`
   * (or 1990) to `max` (or 2100). Default false.
   */
  yearDropdown?: boolean
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
  yearDropdown: boolean
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
  yearDropdown,
  disabled,
  required,
  ...slotProps
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const valueId = useId()
  const { date: formatDate } = useDateFormatter()
  const iso = typeof value === 'string' && isValidISODate(value) ? value : undefined
  const selected = iso ? parseISODate(iso) : undefined
  const minDate = min && isValidISODate(min) ? parseISODate(min) : undefined
  const maxDate = max && isValidISODate(max) ? parseISODate(max) : undefined
  const showClear = clearable && iso !== undefined && !disabled
  const disabledMatchers = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ]

  return (
    <div className="relative">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onBlur()
        }}
      >
        <PopoverTrigger asChild>
          <button
            {...slotProps}
            ref={inputRef}
            name={name}
            type="button"
            disabled={disabled}
            aria-labelledby={`${labelId} ${valueId}`}
            aria-required={required || undefined}
            aria-haspopup="dialog"
            className={cn(
              inputClassName,
              'flex items-center justify-between gap-2 text-left',
              !iso && 'text-muted-foreground',
              showClear && 'pr-9',
            )}
          >
            <span id={valueId} className="truncate">
              {iso ? formatDate(iso) : placeholder}
            </span>
            {/* The clear button below takes the icon's place, so the field never changes width. */}
            {showClear ? null : (
              <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" aria-label={`Choose ${label}`}>
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
            {...(yearDropdown
              ? { captionLayout: 'dropdown' as const, startMonth: minDate ?? new Date(1990, 0), endMonth: maxDate ?? new Date(2100, 11) }
              : { startMonth: minDate, endMonth: maxDate })}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {showClear ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
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
  yearDropdown = false,
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
              yearDropdown={yearDropdown}
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
