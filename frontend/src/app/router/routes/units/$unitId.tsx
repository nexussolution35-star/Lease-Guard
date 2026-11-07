import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { useUnit } from '@/services/units'

export const Route = createFileRoute('/units/$unitId')({
  component: function UnitDetailScreen() {
    const { unitId } = useParams({ from: '/units/$unitId' })
    const record = useUnit(unitId)
    if (!record) return <RecordNotFound entityLabel="Unit" backTo="/units" backLabel="Back to units" />
    return <ScreenPlaceholder title={`Unit ${record.unitNumber}`} description="Unit details, occupancy history and current lease." />
  },
})
