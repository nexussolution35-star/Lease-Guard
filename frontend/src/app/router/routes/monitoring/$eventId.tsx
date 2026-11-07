import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { useEvent } from '@/services/monitoring'

export const Route = createFileRoute('/monitoring/$eventId')({
  component: function MonitoringEventScreen() {
    const { eventId } = useParams({ from: '/monitoring/$eventId' })
    const record = useEvent(eventId)
    if (!record) return <RecordNotFound entityLabel="Monitoring event" backTo="/monitoring" backLabel="Back to monitoring" />
    return <ScreenPlaceholder title={record.title} description="Event details, calculation and recommended action." />
  },
})
