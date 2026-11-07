import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/monitoring/')({
  component: function MonitoringScreen() {
    return <ScreenPlaceholder title="Monitoring" description="Escalation discrepancies, expiries, deadlines and other monitoring events." />
  },
})
