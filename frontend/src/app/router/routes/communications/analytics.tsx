import { createFileRoute } from '@tanstack/react-router'

import { analyticsSearchSchema } from '@/features/communications/analyticsSearch'
import { CommunicationAnalyticsScreen } from '@/features/communications/components/CommunicationAnalyticsScreen'

export const Route = createFileRoute('/communications/analytics')({
  validateSearch: analyticsSearchSchema,
  component: function CommunicationAnalyticsRoute() {
    const { from, to } = Route.useSearch()
    const navigate = Route.useNavigate()
    return <CommunicationAnalyticsScreen from={from} to={to} onRangeChange={(range) => void navigate({ search: range })} />
  },
})
