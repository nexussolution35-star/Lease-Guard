import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/reports/')({
  component: function ReportsScreen() {
    return <ScreenPlaceholder title="Reports" description="Portfolio, arrears and monitoring reports." />
  },
})
