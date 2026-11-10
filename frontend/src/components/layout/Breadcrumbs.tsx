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
import { useArrangementQuery } from '@/features/arrangements/api'
import { useLeaseQuery } from '@/features/leases/api'
import { useMonitoringEventQuery } from '@/features/monitoring/api'
import { usePropertyQuery } from '@/features/properties/api'
import { useStatementQuery } from '@/features/statements/api'
import { useTenantQuery } from '@/features/tenants/api'
import { useUnitQuery } from '@/features/units/api'
import { cn } from '@/lib/utils'

export interface BreadcrumbsProps {
  /** Explicit trail. When omitted, the trail is derived from the current route. */
  items?: readonly BreadcrumbEntry[]
  className?: string
}

function detailIdFor(pathname: string, section: string): string {
  const [, first, second] = pathname.split('/')
  if (first !== section || !second) return ''
  try {
    return decodeURIComponent(second)
  } catch {
    return second
  }
}

/** A resolver that names only the record on screen (`id`), once its label is known. */
function resolverFor(currentId: string, label: string | undefined): (id: string) => string | undefined {
  return (id) => (label && id === currentId ? label : undefined)
}

/**
 * Resolve the record on the current detail route through its detail query (shared with the
 * screen, so no extra request). Each query is enabled only while the pathname is in its section, so a
 * route requests at most its own record (plus the tenant behind an arrangement, for its label).
 */
function useRecordResolvers(pathname: string): BreadcrumbResolvers {
  const propertyId = detailIdFor(pathname, 'properties')
  const unitId = detailIdFor(pathname, 'units')
  const tenantId = detailIdFor(pathname, 'tenants')
  const leaseId = detailIdFor(pathname, 'leases')
  const statementId = detailIdFor(pathname, 'statements')
  const eventId = detailIdFor(pathname, 'monitoring')
  const arrangementId = detailIdFor(pathname, 'arrangements')

  const property = usePropertyQuery(propertyId, { enabled: propertyId !== '' }).data
  const unit = useUnitQuery(unitId, { enabled: unitId !== '' }).data
  const tenant = useTenantQuery(tenantId, { enabled: tenantId !== '' }).data
  const lease = useLeaseQuery(leaseId, { enabled: leaseId !== '' }).data
  const statement = useStatementQuery(statementId, { enabled: statementId !== '' }).data
  const event = useMonitoringEventQuery(eventId, { enabled: eventId !== '' }).data
  const arrangement = useArrangementQuery(arrangementId, { enabled: arrangementId !== '' }).data
  const arrangementTenantId = arrangementId !== '' ? (arrangement?.tenantId ?? '') : ''
  const arrangementTenant = useTenantQuery(arrangementTenantId, { enabled: arrangementTenantId !== '' }).data

  const propertyLabel = property?.name
  const unitLabel = unit ? `Unit ${unit.unitNumber}` : undefined
  const tenantLabel = tenant?.tradingName
  const leaseLabel = lease?.reference
  const statementLabel = statement ? (statement.statementNumber ?? statement.file.fileName) : undefined
  const eventLabel = event?.title
  const arrangementLabel = arrangementTenant ? `${arrangementTenant.tradingName} arrangement` : undefined

  return useMemo(
    () => ({
      properties: resolverFor(propertyId, propertyLabel),
      units: resolverFor(unitId, unitLabel),
      tenants: resolverFor(tenantId, tenantLabel),
      leases: resolverFor(leaseId, leaseLabel),
      statements: resolverFor(statementId, statementLabel),
      monitoring: resolverFor(eventId, eventLabel),
      arrangements: resolverFor(arrangementId, arrangementLabel),
    }),
    [
      propertyId, propertyLabel, unitId, unitLabel, tenantId, tenantLabel, leaseId, leaseLabel,
      statementId, statementLabel, eventId, eventLabel, arrangementId, arrangementLabel,
    ],
  )
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const resolvers = useRecordResolvers(pathname)
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
