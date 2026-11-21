import { createFileRoute } from '@tanstack/react-router'

import { ReportCatalogueScreen } from '@/features/reports/components/ReportCatalogueScreen'

export const Route = createFileRoute('/reports/')({
  component: ReportCatalogueScreen,
})
