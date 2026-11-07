import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/communications/')({
  component: function CommunicationsScreen() {
    return <ScreenPlaceholder title="Communications" description="Tenant statement and payment messages, and owner updates." />
  },
})
