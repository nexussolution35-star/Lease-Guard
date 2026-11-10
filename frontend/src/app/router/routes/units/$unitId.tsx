import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useUnitQuery } from '@/features/units/api'

export const Route = createFileRoute('/units/$unitId')({
  component: function UnitDetailScreen() {
    const { unitId } = useParams({ from: '/units/$unitId' })
    const query = useUnitQuery(unitId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Unit" backTo="/units" backLabel="Back to units" />}
      >
        {(record) => <ScreenPlaceholder title={`Unit ${record.unitNumber}`} description="Unit details, occupancy history and current lease." />}
      </RecordQueryView>
    )
  },
})
