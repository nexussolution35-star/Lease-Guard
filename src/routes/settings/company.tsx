import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/settings/company')({
  component: function CompanySettingsScreen() {
    return <ScreenPlaceholder title="Company" description="Company details and monitoring defaults." />
  },
})
