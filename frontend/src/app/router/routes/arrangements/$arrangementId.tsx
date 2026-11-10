import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useArrangementQuery } from '@/features/arrangements/api'

export const Route = createFileRoute('/arrangements/$arrangementId')({
  component: function ArrangementDetailScreen() {
    const { arrangementId } = useParams({ from: '/arrangements/$arrangementId' })
    const query = useArrangementQuery(arrangementId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Payment arrangement" backTo="/arrangements" backLabel="Back to arrangements" />}
      >
        {() => <ScreenPlaceholder title={'Payment arrangement'} description="Instalment schedule and monitoring status. No payments are processed." />}
      </RecordQueryView>
    )
  },
})
