import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { useProperty } from '@/services/properties'

export const Route = createFileRoute('/properties/$propertyId')({
  component: function PropertyDetailScreen() {
    const { propertyId } = useParams({ from: '/properties/$propertyId' })
    const record = useProperty(propertyId)
    if (!record) return <RecordNotFound entityLabel="Property" backTo="/properties" backLabel="Back to properties" />
    return <ScreenPlaceholder title={record.name} description="Property overview, units, leases and monitoring events." />
  },
})
