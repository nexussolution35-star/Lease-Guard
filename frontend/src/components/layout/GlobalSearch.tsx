import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Command, CommandInput } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { MIN_SEARCH_LENGTH, useWorkspaceSearch, type SearchResult } from '@/services/search'

import { SearchResults } from './SearchResults'

export interface GlobalSearchProps {
  className?: string
}

const DEBOUNCE_MS = 200

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

/** Workspace search: topbar trigger plus a command palette opened with ⌘K / Ctrl+K. */
export function GlobalSearch({ className }: GlobalSearchProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const debounced = useDebounced(term, DEBOUNCE_MS)
  const groups = useWorkspaceSearch(debounced, 5)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setTerm('')
  }

  const handleSelect = (result: SearchResult) => {
    handleOpenChange(false)
    void navigate({ to: result.href as never })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Search workspace"
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          'h-9 justify-start gap-2 px-2.5 text-muted-foreground sm:w-56 lg:w-72',
          className,
        )}
      >
        <Search aria-hidden="true" />
        <span className="hidden sm:inline">Search workspace…</span>
        <kbd className="pointer-events-none ml-auto hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline">
          ⌘K
        </kbd>
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>Search workspace</DialogTitle>
            <DialogDescription>
              Search properties, units, tenants, leases, statements, monitoring events, arrangements and
              communications in the active workspace.
            </DialogDescription>
          </DialogHeader>
          <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
            <CommandInput
              value={term}
              onValueChange={setTerm}
              placeholder="Search tenants, leases, statements…"
              aria-label="Search term"
            />
            <SearchResults
              groups={debounced === term ? groups : []}
              term={debounced}
              minLength={MIN_SEARCH_LENGTH}
              onSelect={handleSelect}
            />
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}
