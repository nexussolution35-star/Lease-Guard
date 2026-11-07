import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/arrangements/')({
  component: function ArrangementsScreen() {
    return <ScreenPlaceholder title="Payment arrangements" description="Monitoring records of agreed arrears arrangements. No payments are processed." />
  },
})
