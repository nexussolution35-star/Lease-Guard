import { createFileRoute } from '@tanstack/react-router'

import { RecordNotFound } from '@/components/layout'
import { ReportScreen } from '@/features/reports/components/ReportScreen'
import { findReportDefinition } from '@/features/reports/reportDefinitions'
import { reportSearchSchema } from '@/features/reports/reportSearch'

export const Route = createFileRoute('/reports/$reportId')({
  // The report frame's filters live in the URL; invalid values fall back to "no filter".
  validateSearch: reportSearchSchema,
  component: function ReportRoute() {
    const { reportId } = Route.useParams()
    const search = Route.useSearch()
    const navigate = Route.useNavigate()
    const definition = findReportDefinition(reportId)
    if (!definition) {
      return (
        <RecordNotFound
          entityLabel="Report"
          title="Report not found"
          description="There is no report with this name. Choose one from the reports list."
          backTo="/reports"
          backLabel="Back to reports"
        />
      )
    }
    return <ReportScreen definition={definition} search={search} onSearchChange={(next) => void navigate({ search: next, replace: true })} />
  },
})
