import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/units/')({
  component: function UnitsScreen() {
    return <ScreenPlaceholder title="Units" description="Lettable units, occupancy and current tenants." />
  },
})
