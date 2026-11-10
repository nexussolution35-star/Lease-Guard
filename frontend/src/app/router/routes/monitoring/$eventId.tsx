import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useMonitoringEventQuery } from '@/features/monitoring/api'

export const Route = createFileRoute('/monitoring/$eventId')({
  component: function MonitoringEventScreen() {
    const { eventId } = useParams({ from: '/monitoring/$eventId' })
    const query = useMonitoringEventQuery(eventId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Monitoring event" backTo="/monitoring" backLabel="Back to monitoring" />}
      >
        {(record) => <ScreenPlaceholder title={record.title} description="Event details, calculation and recommended action." />}
      </RecordQueryView>
    )
  },
})
