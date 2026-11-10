import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useLeaseQuery } from '@/features/leases/api'

export const Route = createFileRoute('/leases/$leaseId')({
  component: function LeaseDetailScreen() {
    const { leaseId } = useParams({ from: '/leases/$leaseId' })
    const query = useLeaseQuery(leaseId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Lease" backTo="/leases" backLabel="Back to leases" />}
      >
        {(record) => <ScreenPlaceholder title={record.reference} description="Lease terms, escalations, guarantees and verification." />}
      </RecordQueryView>
    )
  },
})
