import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useUnitQuery } from '@/features/units/api'
import { UnitDetailScreen } from '@/features/units/components/UnitDetailScreen'

export const Route = createFileRoute('/units/$unitId')({
  component: function UnitDetailRoute() {
    const { unitId } = useParams({ from: '/units/$unitId' })
    const query = useUnitQuery(unitId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Unit" backTo="/units" backLabel="Back to units" />}
      >
        {(record) => <UnitDetailScreen unit={record} />}
      </RecordQueryView>
    )
  },
})
