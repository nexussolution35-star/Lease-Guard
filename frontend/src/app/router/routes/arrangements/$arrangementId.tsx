import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useArrangementQuery } from '@/features/arrangements/api'
import { ArrangementDetailScreen } from '@/features/arrangements/components/ArrangementDetailScreen'

export const Route = createFileRoute('/arrangements/$arrangementId')({
  component: function ArrangementDetailRoute() {
    const { arrangementId } = useParams({ from: '/arrangements/$arrangementId' })
    const query = useArrangementQuery(arrangementId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Payment arrangement" backTo="/arrangements" backLabel="Back to arrangements" />}
      >
        {(record) => <ArrangementDetailScreen arrangement={record} />}
      </RecordQueryView>
    )
  },
})
