import { createFileRoute } from '@tanstack/react-router'

import { CompanySettingsScreen } from '@/features/company/components/CompanySettingsScreen'

export const Route = createFileRoute('/settings/company')({
  component: CompanySettingsScreen,
})
