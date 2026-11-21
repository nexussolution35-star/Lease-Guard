import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useLeaseQuery } from '@/features/leases/api'
import { LeaseDetailScreen } from '@/features/leases/components/LeaseDetailScreen'

export const Route = createFileRoute('/leases/$leaseId')({
  component: function LeaseDetailRoute() {
    const { leaseId } = useParams({ from: '/leases/$leaseId' })
    const query = useLeaseQuery(leaseId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Lease" backTo="/leases" backLabel="Back to leases" />}
      >
        {(record) => <LeaseDetailScreen lease={record} />}
      </RecordQueryView>
    )
  },
})
