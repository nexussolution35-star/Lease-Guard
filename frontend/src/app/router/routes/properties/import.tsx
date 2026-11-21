import { createFileRoute } from '@tanstack/react-router'

import { PortfolioImportScreen } from '@/features/portfolio-imports/components/PortfolioImportScreen'
import { portfolioImportSearchSchema } from '@/features/portfolio-imports/importSearch'

export const Route = createFileRoute('/properties/import')({
  validateSearch: portfolioImportSearchSchema,
  component: function PortfolioImportRoute() {
    const { importId, propertyId } = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <PortfolioImportScreen
        importId={importId}
        propertyId={propertyId}
        onImported={(batch) => void navigate({ search: { importId: batch.id }, replace: true })}
      />
    )
  },
})
