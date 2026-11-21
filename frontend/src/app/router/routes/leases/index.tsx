import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { LeaseListScreen } from '@/features/leases/components/LeaseListScreen'
import { LEASE_LIST_DEFAULTS, leaseListSearchSchema } from '@/features/leases/listSearch'

export const Route = createFileRoute('/leases/')({
  validateSearch: leaseListSearchSchema,
  search: { middlewares: [stripSearchParams(LEASE_LIST_DEFAULTS)] },
  component: function LeasesScreen() {
    const params = Route.useSearch()
    const navigate = Route.useNavigate()
    return <LeaseListScreen params={params} onParamsChange={(next) => void navigate({ search: next, replace: true })} />
  },
})
