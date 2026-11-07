import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/communications/approvals')({
  component: function ApprovalsScreen() {
    return <ScreenPlaceholder title="Message approvals" description="Tenant messages awaiting property-manager approval before sending." />
  },
})
