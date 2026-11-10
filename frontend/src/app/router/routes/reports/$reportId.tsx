import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { findReportDefinition } from '@/features/reports/reportDefinitions'

export const Route = createFileRoute('/reports/$reportId')({
  component: function ReportScreen() {
    const { reportId } = useParams({ from: '/reports/$reportId' })
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
    return <ScreenPlaceholder title={definition.title} description={definition.description} />
  },
})
