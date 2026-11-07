import { useRouterState } from '@tanstack/react-router'
import { Fragment, useMemo } from 'react'

import { AppLink } from '@/components/shared'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { breadcrumbsFor, type BreadcrumbEntry, type BreadcrumbResolvers } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { useAllArrangements } from '@/services/arrangements'
import { useAllLeases } from '@/services/leases'
import { useAllEvents } from '@/services/monitoring'
import { useAllProperties } from '@/services/properties'
import { useAllStatements } from '@/services/statements'
import { useAllTenants } from '@/services/tenants'
import { useAllUnits } from '@/services/units'

export interface BreadcrumbsProps {
  /** Explicit trail. When omitted, the trail is derived from the current route. */
  items?: readonly BreadcrumbEntry[]
  className?: string
}

/** Record-name resolvers for detail routes, scoped to the active workspace. */
function useRecordResolvers(): BreadcrumbResolvers {
  const properties = useAllProperties()
  const units = useAllUnits()
  const tenants = useAllTenants()
  const leases = useAllLeases()
  const statements = useAllStatements()
  const events = useAllEvents()
  const arrangements = useAllArrangements()

  return useMemo(() => {
    const byId = <T extends { id: string }>(rows: readonly T[], label: (row: T) => string | undefined) => {
      const map = new Map(rows.map((r) => [r.id, r]))
      return (id: string) => {
        const row = map.get(id)
        return row ? label(row) : undefined
      }
    }
    const tenantName = byId(tenants, (t) => t.tradingName)
    return {
      properties: byId(properties, (p) => p.name),
      units: byId(units, (u) => `Unit ${u.unitNumber}`),
      tenants: tenantName,
      leases: byId(leases, (l) => l.reference),
      statements: byId(statements, (s) => s.statementNumber ?? s.file.fileName),
      monitoring: byId(events, (e) => e.title),
      arrangements: byId(arrangements, (a) => (tenantName(a.tenantId) ? `${tenantName(a.tenantId)} arrangement` : undefined)),
    }
  }, [properties, units, tenants, leases, statements, events, arrangements])
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const resolvers = useRecordResolvers()
  const trail = useMemo(() => items ?? breadcrumbsFor(pathname, resolvers), [items, pathname, resolvers])

  return (
    <Breadcrumb className={cn('min-w-0', className)}>
      <BreadcrumbList className="flex-nowrap">
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              <BreadcrumbItem className={cn('min-w-0', !isLast && 'hidden sm:inline-flex')}>
                {crumb.to && !isLast ? (
                  <BreadcrumbLink asChild>
                    <AppLink to={crumb.to} className="truncate">
                      {crumb.label}
                    </AppLink>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {isLast ? null : <BreadcrumbSeparator className="hidden sm:inline-flex" />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
