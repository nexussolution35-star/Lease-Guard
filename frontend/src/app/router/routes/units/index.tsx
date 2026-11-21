import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { UnitListScreen } from '@/features/units/components/UnitListScreen'
import { UNIT_LIST_DEFAULTS, unitListSearchSchema } from '@/features/units/listSearch'

export const Route = createFileRoute('/units/')({
  validateSearch: unitListSearchSchema,
  search: { middlewares: [stripSearchParams(UNIT_LIST_DEFAULTS)] },
  component: function UnitsScreen() {
    const params = Route.useSearch()
    const navigate = Route.useNavigate()
    return <UnitListScreen params={params} onParamsChange={(next) => void navigate({ search: next, replace: true })} />
  },
})
