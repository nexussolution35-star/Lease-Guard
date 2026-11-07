import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/settings/audit')({
  component: function AuditLogScreen() {
    return <ScreenPlaceholder title="Audit log" description="Every change made in this workspace." />
  },
})
