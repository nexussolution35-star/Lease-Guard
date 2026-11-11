import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { AUDIT_DEFAULTS, auditSearchSchema } from '@/features/audit/auditSearch'
import { AuditLogScreen } from '@/features/audit/components/AuditLogScreen'

export const Route = createFileRoute('/settings/audit')({
  validateSearch: auditSearchSchema,
  search: { middlewares: [stripSearchParams(AUDIT_DEFAULTS)] },
  component: function AuditLogRoute() {
    const search = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <AuditLogScreen
        search={search}
        onFiltersChange={(filters) => void navigate({ search: { ...filters, page: AUDIT_DEFAULTS.page, pageSize: search.pageSize }, replace: true })}
        onPageChange={(page) => void navigate({ search: { ...search, page }, replace: true })}
      />
    )
  },
})
