import { createFileRoute, useParams } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'
import { breadcrumbsFor } from '@/lib/navigation'

export const Route = createFileRoute('/reports/$reportId')({
  component: function ReportScreen() {
    const { reportId } = useParams({ from: '/reports/$reportId' })
    const title = breadcrumbsFor(`/reports/${reportId}`).at(-1)?.label ?? 'Report'
    return <ScreenPlaceholder title={title} description="Report details for the active workspace." />
  },
})
