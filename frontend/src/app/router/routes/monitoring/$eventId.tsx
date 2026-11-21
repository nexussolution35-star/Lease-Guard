import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useMonitoringEventQuery } from '@/features/monitoring/api'
import { MonitoringEventDetailScreen } from '@/features/monitoring/components/MonitoringEventDetailScreen'

export const Route = createFileRoute('/monitoring/$eventId')({
  component: function MonitoringEventScreen() {
    const { eventId } = useParams({ from: '/monitoring/$eventId' })
    const query = useMonitoringEventQuery(eventId)
    return (
      <RecordQueryView
        query={query}
        loadingLabel="Loading the monitoring event…"
        notFound={<RecordNotFound entityLabel="Monitoring event" backTo="/monitoring" backLabel="Back to monitoring" />}
      >
        {(record) => <MonitoringEventDetailScreen event={record} />}
      </RecordQueryView>
    )
  },
})
