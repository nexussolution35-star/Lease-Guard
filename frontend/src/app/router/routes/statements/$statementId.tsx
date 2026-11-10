import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { RecordQueryView } from '@/components/shared'
import { useStatementQuery } from '@/features/statements/api'

export const Route = createFileRoute('/statements/$statementId')({
  component: function StatementReviewScreen() {
    const { statementId } = useParams({ from: '/statements/$statementId' })
    const query = useStatementQuery(statementId)
    return (
      <RecordQueryView
        query={query}
        notFound={<RecordNotFound entityLabel="Statement" backTo="/statements" backLabel="Back to statements" />}
      >
        {(record) => <ScreenPlaceholder title={record.statementNumber ?? record.file.fileName} description="Review extracted figures before the statement drives monitoring." />}
      </RecordQueryView>
    )
  },
})
