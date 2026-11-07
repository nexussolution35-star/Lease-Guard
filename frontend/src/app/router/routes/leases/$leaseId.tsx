import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { useLease } from '@/services/leases'

export const Route = createFileRoute('/leases/$leaseId')({
  component: function LeaseDetailScreen() {
    const { leaseId } = useParams({ from: '/leases/$leaseId' })
    const record = useLease(leaseId)
    if (!record) return <RecordNotFound entityLabel="Lease" backTo="/leases" backLabel="Back to leases" />
    return <ScreenPlaceholder title={record.reference} description="Lease terms, escalations, guarantees and verification." />
  },
})
