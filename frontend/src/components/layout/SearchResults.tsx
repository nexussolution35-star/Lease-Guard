import {
  ArrowLeftRight,
  Building2,
  DoorOpen,
  FileSpreadsheet,
  FileText,
  MessagesSquare,
  Search,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react'

import { StatusBadge } from '@/components/shared'
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import type { SearchResult, SearchResultGroup } from '@/services/search'
import type { EntityType } from '@leaseguard/domain'

export interface SearchResultsProps {
  groups: readonly SearchResultGroup[]
  /** The (debounced) term the groups were computed for. */
  term: string
  minLength?: number
  onSelect: (result: SearchResult) => void
  className?: string
}

const ENTITY_ICONS: Partial<Record<EntityType, LucideIcon>> = {
  property: Building2,
  unit: DoorOpen,
  tenant: Users,
  lease: FileText,
  statement: FileSpreadsheet,
  monitoring_event: ShieldAlert,
  payment_arrangement: ArrowLeftRight,
  communication: MessagesSquare,
}

export function SearchResults({ groups, term, minLength = 2, onSelect, className }: SearchResultsProps) {
  const tooShort = term.trim().length < minLength
  return (
    <CommandList className={cn('max-h-[60vh]', className)}>
      <CommandEmpty>
        {tooShort ? 'Type at least two characters to search this workspace.' : `No results for “${term.trim()}”.`}
      </CommandEmpty>
      {groups.map((group) => {
        const Icon = ENTITY_ICONS[group.entityType] ?? Search
        return (
          <CommandGroup key={group.entityType} heading={group.label}>
            {group.results.map((result) => (
              <CommandItem
                key={`${result.entityType}:${result.id}`}
                value={`${result.entityType}:${result.id}`}
                onSelect={() => onSelect(result)}
                className="gap-3"
              >
                <Icon className="text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{result.title}</span>
                  {result.subtitle ? (
                    <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>
                  ) : null}
                </span>
                {result.status ? <StatusBadge status={result.status} className="hidden sm:inline-flex" /> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        )
      })}
    </CommandList>
  )
}
