import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { usePropertyQuery } from '@/features/properties/api'
import { PropertyDetailScreen } from '@/features/properties/components/PropertyDetailScreen'

export const Route = createFileRoute('/properties/$propertyId')({
  component: function PropertyDetailRoute() {
    const { propertyId } = useParams({ from: '/properties/$propertyId' })
    const query = usePropertyQuery(propertyId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Property" backTo="/properties" backLabel="Back to properties" />}
      >
        {(record) => <PropertyDetailScreen property={record} />}
      </RecordQueryView>
    )
  },
})
