import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { usePropertyQuery } from '@/features/properties/api'

export const Route = createFileRoute('/properties/$propertyId')({
  component: function PropertyDetailScreen() {
    const { propertyId } = useParams({ from: '/properties/$propertyId' })
    const query = usePropertyQuery(propertyId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Property" backTo="/properties" backLabel="Back to properties" />}
      >
        {(record) => <ScreenPlaceholder title={record.name} description="Property overview, units, leases and monitoring events." />}
      </RecordQueryView>
    )
  },
})
