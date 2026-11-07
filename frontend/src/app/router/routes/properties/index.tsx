import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/properties/')({
  component: function PropertiesScreen() {
    return <ScreenPlaceholder title="Properties" description="Properties in this workspace with occupancy and monitoring status." />
  },
})
