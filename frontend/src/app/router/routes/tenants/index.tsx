import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { TenantListScreen } from '@/features/tenants/components/TenantListScreen'
import { TENANT_LIST_DEFAULTS, tenantListSearchSchema } from '@/features/tenants/listSearch'

export const Route = createFileRoute('/tenants/')({
  validateSearch: tenantListSearchSchema,
  search: { middlewares: [stripSearchParams(TENANT_LIST_DEFAULTS)] },
  component: function TenantsScreen() {
    const params = Route.useSearch()
    const navigate = Route.useNavigate()
    return <TenantListScreen params={params} onParamsChange={(next) => void navigate({ search: next, replace: true })} />
  },
})
