import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { useArrangement } from '@/services/arrangements'

export const Route = createFileRoute('/arrangements/$arrangementId')({
  component: function ArrangementDetailScreen() {
    const { arrangementId } = useParams({ from: '/arrangements/$arrangementId' })
    const record = useArrangement(arrangementId)
    if (!record) return <RecordNotFound entityLabel="Payment arrangement" backTo="/arrangements" backLabel="Back to arrangements" />
    return <ScreenPlaceholder title={'Payment arrangement'} description="Instalment schedule and monitoring status. No payments are processed." />
  },
})
