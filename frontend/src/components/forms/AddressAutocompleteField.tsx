import { Loader2, MapPin } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { FieldPath, FieldValues } from 'react-hook-form'

import { FormControl, FormDescription, FormField as RHFFormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import {
  AddressLookupError,
  getAddressSuggestionSource,
  type AddressSuggestion,
  type AddressSuggestionSource,
  type SuggestedAddress,
} from '@/services/maps/addressSuggestions'
import { cn } from '@/lib/utils'

import { fieldIdFor } from './fieldId'
import { RequiredIndicator } from './RequiredIndicator'
import type { BaseFieldProps } from './types'

/** Characters typed before suggestions are requested, and the pause after the last keystroke. */
const MIN_QUERY_LENGTH = 3
const DEBOUNCE_MS = 250

export interface AddressAutocompleteFieldProps<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>
  extends BaseFieldProps<TFieldValues, TName> {
  /** Called with the chosen suggestion's address; fill the other address fields from it. This field gets `line1`. */
  onAddressSelect: (address: SuggestedAddress) => void
  placeholder?: string
  autoComplete?: string
  maxLength?: number
  /** Defaults to LeaseGuard's API (which calls Google with a server-only key). Tests pass a fake. */
  source?: AddressSuggestionSource
}

type Lookup = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; items: AddressSuggestion[] } | { state: 'failed'; message: string }

const FAILED = 'Address suggestions are unavailable. Type the address in full.'
const failure = (error: unknown) => (error instanceof AddressLookupError ? error.message : FAILED)

/**
 * The first address line with address suggestions from Google Maps as the user types (South Africa), through
 * LeaseGuard's API: the Google key never reaches the browser. Choosing a suggestion fills this line and calls
 * `onAddressSelect` for the rest. Keyboard: arrows move, Enter chooses, Escape closes. When the deployment has no
 * suggestions (no key on the server) it is a plain text field.
 */
export function AddressAutocompleteField<TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>({
  control,
  name,
  label,
  description,
  required = false,
  disabled = false,
  id,
  className,
  onAddressSelect,
  placeholder = 'Start typing an address',
  autoComplete = 'off',
  maxLength,
  source: sourceProp,
}: AddressAutocompleteFieldProps<TFieldValues, TName>) {
  const controlId = id ?? fieldIdFor(name)
  const listId = useId()
  const candidate = sourceProp ?? getAddressSuggestionSource()
  // Suggestions only once the API says they are available; until then (and without them) a plain text field.
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let current = true
    void candidate.available().then((available) => {
      if (current) setEnabled(available)
    })
    return () => {
      current = false
    }
  }, [candidate])
  const source = enabled ? candidate : null
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' })
  const [active, setActive] = useState(-1)
  const [filled, setFilled] = useState(false)
  const latest = useRef(0)

  // Ask for suggestions a moment after the user stops typing; only the newest answer is shown.
  useEffect(() => {
    if (!source || query.trim().length < MIN_QUERY_LENGTH) return
    const request = ++latest.current
    const timer = window.setTimeout(() => {
      setLookup({ state: 'loading' })
      source.suggest(query.trim()).then(
        (items) => {
          if (request !== latest.current) return
          setLookup({ state: 'ready', items })
          setActive(-1)
        },
        (error: unknown) => {
          if (request === latest.current) setLookup({ state: 'failed', message: failure(error) })
        },
      )
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, source])

  return (
    <RHFFormField
      control={control}
      name={name}
      render={({ field }) => {
        const items = lookup.state === 'ready' ? lookup.items : []
        const showList = open && source !== null && query.trim().length >= MIN_QUERY_LENGTH && lookup.state !== 'idle'

        const choose = async (suggestion: AddressSuggestion) => {
          setOpen(false)
          latest.current += 1
          try {
            const address = await source!.resolve(suggestion)
            field.onChange(address.line1 || suggestion.primary)
            onAddressSelect(address)
            setFilled(true)
          } catch (error) {
            setLookup({ state: 'failed', message: failure(error) })
            setOpen(true)
          }
        }

        const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
          if (!showList) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (items.length === 0) return
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive((current) => (current + step + items.length) % items.length)
          } else if (event.key === 'Enter' && active >= 0 && items[active]) {
            event.preventDefault()
            void choose(items[active])
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
        }

        return (
          <FormItem className={className}>
            <FormLabel htmlFor={controlId}>
              {label}
              {required ? <RequiredIndicator /> : null}
            </FormLabel>
            <Popover open={showList} onOpenChange={setOpen} modal={false}>
              <PopoverAnchor asChild>
                <div className="relative">
                  <FormControl id={controlId}>
                    <Input
                      {...field}
                      value={typeof field.value === 'string' ? field.value : ''}
                      onChange={(event) => {
                        field.onChange(event.target.value)
                        setQuery(event.target.value)
                        setFilled(false)
                        setOpen(true)
                        if (event.target.value.trim().length < MIN_QUERY_LENGTH) setLookup({ state: 'idle' })
                      }}
                      onKeyDown={onKeyDown}
                      onBlur={() => {
                        field.onBlur()
                        setOpen(false)
                      }}
                      placeholder={source ? placeholder : undefined}
                      autoComplete={autoComplete}
                      maxLength={maxLength}
                      disabled={disabled}
                      aria-required={required || undefined}
                      {...(source
                        ? {
                            role: 'combobox',
                            'aria-autocomplete': 'list' as const,
                            'aria-expanded': showList,
                            'aria-controls': listId,
                            ...(showList && active >= 0 && items[active] ? { 'aria-activedescendant': `${listId}-${active}` } : {}),
                          }
                        : {})}
                      className={cn(source && 'pr-9')}
                    />
                  </FormControl>
                  {lookup.state === 'loading' ? (
                    <Loader2 className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
                  ) : source ? (
                    <MapPin className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  ) : null}
                </div>
              </PopoverAnchor>
              <PopoverContent
                align="start"
                sideOffset={4}
                className="w-(--radix-popper-anchor-width) overflow-hidden p-0"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="max-h-64 overflow-y-auto p-1">
                  {lookup.state === 'loading' && items.length === 0 ? (
                    <li className="px-2 py-2 text-sm text-muted-foreground" role="presentation">
                      Looking up addresses…
                    </li>
                  ) : null}
                  {lookup.state === 'failed' ? (
                    <li className="px-2 py-2 text-sm text-muted-foreground" role="presentation">
                      {lookup.message}
                    </li>
                  ) : null}
                  {lookup.state === 'ready' && items.length === 0 ? (
                    <li className="px-2 py-2 text-sm text-muted-foreground" role="presentation">
                      No matching addresses in South Africa.
                    </li>
                  ) : null}
                  {items.map((item, index) => (
                    <li
                      key={item.id}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => void choose(item)}
                      className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors aria-selected:bg-accent aria-selected:text-accent-foreground"
                    >
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block truncate text-foreground">{item.primary}</span>
                        {item.secondary ? <span className="block truncate text-xs text-muted-foreground">{item.secondary}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-border px-3 py-1.5 text-right text-xs text-muted-foreground">
                  <span translate="no">Google Maps</span>
                </p>
              </PopoverContent>
            </Popover>
            {filled ? (
              <FormDescription className="animate-in fade-in-0 duration-300">Filled from Google Maps. Check the suburb, city and postal code.</FormDescription>
            ) : description ? (
              <FormDescription>{description}</FormDescription>
            ) : null}
            <FormMessage role="alert" />
          </FormItem>
        )
      }}
    />
  )
}
