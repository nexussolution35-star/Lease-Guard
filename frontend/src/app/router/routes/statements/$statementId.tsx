import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useStatementQuery } from '@/features/statements/api'
import { StatementReviewScreen } from '@/features/statements/components/review/StatementReviewScreen'

export const Route = createFileRoute('/statements/$statementId')({
  component: function StatementReviewRoute() {
    const { statementId } = useParams({ from: '/statements/$statementId' })
    const query = useStatementQuery(statementId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Statement" backTo="/statements" backLabel="Back to statements" />}
      >
        {(record) => <StatementReviewScreen statement={record} />}
      </RecordQueryView>
    )
  },
})
