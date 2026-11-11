import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  DoorOpen,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  Settings,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react'

import type { EntityId, EntityType } from '@leaseguard/domain'

export interface NavItem {
  id: string
  label: string
  /** Route path, e.g. `/properties`. */
  to: string
  icon: LucideIcon
}

export interface NavSection {
  id: string
  label: string
  items: readonly NavItem[]
}

/** The single navigation config used by the sidebar, mobile drawer and breadcrumbs. */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', to: '/', icon: LayoutDashboard }],
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    items: [
      { id: 'properties', label: 'Properties', to: '/properties', icon: Building2 },
      { id: 'units', label: 'Units', to: '/units', icon: DoorOpen },
      { id: 'tenants', label: 'Tenants', to: '/tenants', icon: Users },
      { id: 'leases', label: 'Leases', to: '/leases', icon: FileText },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'statements', label: 'Statements', to: '/statements', icon: FileSpreadsheet },
      { id: 'monitoring', label: 'Monitoring', to: '/monitoring', icon: ShieldAlert },
      { id: 'arrangements', label: 'Arrangements', to: '/arrangements', icon: ArrowLeftRight },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    items: [
      { id: 'communications', label: 'Communications', to: '/communications', icon: MessagesSquare },
      { id: 'whatsapp', label: 'WhatsApp', to: '/whatsapp', icon: MessageCircle },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [{ id: 'reports', label: 'Reports', to: '/reports', icon: BarChart3 }],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [{ id: 'settings', label: 'Settings', to: '/settings', icon: Settings }],
  },
]

export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((s) => s.items)

/** True when `pathname` is the item's route or nested beneath it. `/` only matches exactly. */
export function isNavItemActive(item: Pick<NavItem, 'to'>, pathname: string): boolean {
  const path = normalisePath(pathname)
  if (item.to === '/') return path === '/'
  return path === item.to || path.startsWith(`${item.to}/`)
}

function normalisePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname || '/'
}

// ---------------------------------------------------------------------------
// Entity routes
// ---------------------------------------------------------------------------

const ENTITY_ROUTES: Partial<Record<EntityType, string>> = {
  property: '/properties',
  unit: '/units',
  tenant: '/tenants',
  lease: '/leases',
  statement: '/statements',
  statement_extraction: '/statements',
  monitoring_event: '/monitoring',
  payment_arrangement: '/arrangements',
  communication: '/communications',
  message_approval: '/communications/approvals',
  message_template: '/settings/templates',
  user: '/settings/users',
  company: '/settings/company',
  audit_log: '/settings/audit',
}

/** Entity types whose route has a `/$id` detail screen. */
const DETAIL_ENTITY_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  'property',
  'unit',
  'tenant',
  'lease',
  'statement',
  'monitoring_event',
  'payment_arrangement',
])

/** The in-app href for a record, or `undefined` when the entity type has no screen. */
export function entityHref(entityType: EntityType, entityId?: EntityId): string | undefined {
  const base = ENTITY_ROUTES[entityType]
  if (!base) return undefined
  if (entityId && DETAIL_ENTITY_TYPES.has(entityType)) return `${base}/${encodeURIComponent(entityId)}`
  return base
}

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

export interface BreadcrumbEntry {
  label: string
  /** Omitted for the current (last) crumb. */
  to?: string
}

/**
 * Optional label resolvers keyed by the parent segment, e.g.
 * `{ properties: (id) => propertyName(id) }`. Return `undefined` to fall back to the raw segment.
 */
export type BreadcrumbResolvers = Readonly<Record<string, (segment: string) => string | undefined>>

const STATIC_SEGMENT_LABELS: Readonly<Record<string, string>> = {
  upload: 'Upload',
  approvals: 'Approvals',
  analytics: 'Analytics',
  conversations: 'Conversations',
  company: 'Company',
  users: 'Users',
  roles: 'Roles',
  notifications: 'Notifications',
  integrations: 'Integrations',
  whatsapp: 'WhatsApp',
  agent: 'AI agent',
  templates: 'Templates',
  audit: 'Audit log',
  preferences: 'Preferences',
}

function labelForSegment(segment: string, parent: string | undefined, resolvers: BreadcrumbResolvers | undefined): string {
  const topLevel = parent === undefined ? NAV_ITEMS.find((i) => i.to === `/${segment}`) : undefined
  if (topLevel) return topLevel.label
  const resolved = parent !== undefined ? resolvers?.[parent]?.(segment) : undefined
  if (resolved) return resolved
  const known = STATIC_SEGMENT_LABELS[segment]
  if (known) return known
  const decoded = safeDecode(segment)
  return decoded.charAt(0).toUpperCase() + decoded.slice(1).replace(/[-_]/g, ' ')
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Breadcrumb trail for a pathname. The dashboard (`/`) yields a single "Dashboard" crumb;
 * other paths start at their top-level section. The last crumb has no `to`.
 */
export function breadcrumbsFor(pathname: string, resolvers?: BreadcrumbResolvers): BreadcrumbEntry[] {
  const segments = normalisePath(pathname).split('/').filter(Boolean)
  if (segments.length === 0) return [{ label: 'Dashboard' }]

  return segments.map((segment, index) => {
    const parent = index === 0 ? undefined : segments[index - 1]
    const label = labelForSegment(segment, parent, resolvers)
    const isLast = index === segments.length - 1
    return isLast ? { label } : { label, to: `/${segments.slice(0, index + 1).join('/')}` }
  })
}
