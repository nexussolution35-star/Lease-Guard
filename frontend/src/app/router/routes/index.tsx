import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/')({
  component: function DashboardScreen() {
    return <ScreenPlaceholder title="Dashboard" description="Portfolio health, monitoring events and items awaiting your action." />
  },
})
