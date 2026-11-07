import { createFileRoute, useParams } from '@tanstack/react-router'

import { RecordNotFound, ScreenPlaceholder } from '@/components/layout'
import { useStatement } from '@/services/statements'

export const Route = createFileRoute('/statements/$statementId')({
  component: function StatementReviewScreen() {
    const { statementId } = useParams({ from: '/statements/$statementId' })
    const record = useStatement(statementId)
    if (!record) return <RecordNotFound entityLabel="Statement" backTo="/statements" backLabel="Back to statements" />
    return <ScreenPlaceholder title={record.statementNumber ?? record.file.fileName} description="Review extracted figures before the statement drives monitoring." />
  },
})
