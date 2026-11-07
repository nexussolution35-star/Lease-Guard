import { useId, useState } from 'react'
import type { FieldPath, FieldValues } from 'react-hook-form'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  FormControl,
  FormDescription,
  FormField as RHFFormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { fieldIdFor } from './fieldId'
import type { FieldOption } from './options'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps, SlotA11yProps } from './types'

export interface MultiSelectFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
  T extends string = string,
> extends BaseFieldProps<TFieldValues, TName> {
  options: readonly FieldOption<T>[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
}

interface MultiSelectControlProps<T extends string> extends SlotA11yProps {
  value: unknown
  onChange: (value: T[]) => void
  onBlur: () => void
  inputRef: (instance: HTMLButtonElement | null) => void
  options: readonly FieldOption<T>[]
  label: string
  labelId: string
  placeholder: string
  searchPlaceholder: string
  emptyMessage: string
  disabled: boolean
  required: boolean
}

function MultiSelectControl<T extends string>({
  value,
  onChange,
  onBlur,
  inputRef,
  options,
  label,
  labelId,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  required,
  ...slotProps
}: MultiSelectControlProps<T>) {
  const [open, setOpen] = useState(false)
  const summaryId = useId()
  const selectedValues: T[] = Array.isArray(value)
    ? (value as unknown[]).filter((v): v is T => options.some((o) => o.value === v))
    : []
  const selectedOptions = options.filter((o) => selectedValues.includes(o.value))

  const toggle = (optionValue: T) => {
    onChange(
      selectedValues.includes(optionValue)
        ? selectedValues.filter((v) => v !== optionValue)
        : [...selectedValues, optionValue],
    )
  }

  const summary =
    selectedOptions.length === 0 ? placeholder : `${selectedOptions.length} selected`

  return (
    <div className="grid gap-2">
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
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={`${labelId} ${summaryId}`}
            aria-required={required || undefined}
            disabled={disabled}
            className={cn(
              'w-full justify-between font-normal',
              selectedOptions.length === 0 && 'text-muted-foreground',
            )}
          >
            <span id={summaryId}>{summary}</span>
            <ChevronsUpDown className="size-4 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} aria-label={`Search ${label}`} />
            <CommandList aria-multiselectable="true">
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const checked = selectedValues.includes(option.value)
                  return (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value}`}
                      disabled={option.disabled}
                      onSelect={() => toggle(option.value)}
                      data-checked={checked}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex size-4 items-center justify-center rounded-[4px] border border-input',
                          checked && 'border-primary bg-primary text-primary-foreground',
                        )}
                      >
                        {checked ? <Check className="size-3 text-current" /> : null}
                      </span>
                      <span>{option.label}</span>
                      {checked ? <span className="sr-only">(selected)</span> : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedOptions.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Selected ${label}`}>
          {selectedOptions.map((option) => (
            <li key={option.value}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {option.label}
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => toggle(option.value)}
                    aria-label={`Remove ${option.label}`}
                    className="rounded-full p-0.5 outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ) : null}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Searchable multi-select storing an array of option values; selections shown as badges. */
export function MultiSelectField<
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
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches found.',
}: MultiSelectFieldProps<TFieldValues, TName, T>) {
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
            <MultiSelectControl<T>
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              options={options}
              label={label}
              labelId={labelId}
              placeholder={placeholder}
              searchPlaceholder={searchPlaceholder}
              emptyMessage={emptyMessage}
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
