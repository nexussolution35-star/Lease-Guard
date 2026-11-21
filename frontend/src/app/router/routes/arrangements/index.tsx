import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { ArrangementListScreen } from '@/features/arrangements/components/ArrangementListScreen'
import { ARRANGEMENT_LIST_DEFAULTS, arrangementListSearchSchema } from '@/features/arrangements/listSearch'

export const Route = createFileRoute('/arrangements/')({
  validateSearch: arrangementListSearchSchema,
  search: { middlewares: [stripSearchParams(ARRANGEMENT_LIST_DEFAULTS)] },
  component: function ArrangementsScreen() {
    const params = Route.useSearch()
    const navigate = Route.useNavigate()
    return <ArrangementListScreen params={params} onParamsChange={(next) => void navigate({ search: next, replace: true })} />
  },
})
