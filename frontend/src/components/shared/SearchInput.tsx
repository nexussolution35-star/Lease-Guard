import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { MAX_LIST_SEARCH_LENGTH } from '@/lib/data/listParams'
import { cn } from '@/lib/utils'

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Debounce before `onChange` fires while typing. Default 250ms. Clearing is immediate. */
  debounceMs?: number
  /** Visually hidden label. Default `Search`. */
  label?: string
  /** Longest text the box accepts. Default `MAX_LIST_SEARCH_LENGTH`, the list endpoints' limit. */
  maxLength?: number
  className?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  debounceMs = 250,
  label = 'Search',
  maxLength = MAX_LIST_SEARCH_LENGTH,
  className,
}: SearchInputProps) {
  const id = useId()
  const [text, setText] = useState(value)
  const [syncedValue, setSyncedValue] = useState(value)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Adopt external changes to `value` (e.g. "clear filters") during render.
  if (value !== syncedValue) {
    setSyncedValue(value)
    setText(value)
  }

  useEffect(() => {
    if (text === value) return
    const timer = window.setTimeout(() => onChangeRef.current(text), debounceMs)
    return () => window.clearTimeout(timer)
  }, [text, value, debounceMs])

  function clear() {
    setText('')
    if (value !== '') onChangeRef.current('')
  }

  return (
    <div className={cn('relative w-full sm:max-w-xs', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={id}
        type="search"
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={maxLength}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text !== '') {
            event.preventDefault()
            clear()
          }
        }}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {text !== '' ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
