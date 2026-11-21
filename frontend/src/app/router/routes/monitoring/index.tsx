import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { MonitoringEventListScreen } from '@/features/monitoring/components/MonitoringEventListScreen'
import { MONITORING_LIST_DEFAULTS, monitoringListSearchSchema } from '@/features/monitoring/listSearch'

export const Route = createFileRoute('/monitoring/')({
  validateSearch: monitoringListSearchSchema,
  search: { middlewares: [stripSearchParams(MONITORING_LIST_DEFAULTS)] },
  component: function MonitoringScreen() {
    const params = Route.useSearch()
    const navigate = Route.useNavigate()
    return <MonitoringEventListScreen params={params} onParamsChange={(next) => void navigate({ search: next, replace: true })} />
  },
})
