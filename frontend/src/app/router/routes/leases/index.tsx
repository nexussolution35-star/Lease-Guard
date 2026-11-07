import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/leases/')({
  component: function LeasesScreen() {
    return <ScreenPlaceholder title="Leases" description="Lease terms, verification status, expiry and renewal deadlines." />
  },
})
