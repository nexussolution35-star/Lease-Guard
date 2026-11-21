import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { StatementArrearsSummary } from '@/features/statements/components/StatementArrearsSummary'
import { StatementListScreen } from '@/features/statements/components/StatementListScreen'
import { STATEMENT_LIST_DEFAULTS, statementListSearchSchema } from '@/features/statements/listSearch'

export const Route = createFileRoute('/statements/')({
  validateSearch: statementListSearchSchema,
  search: { middlewares: [stripSearchParams(STATEMENT_LIST_DEFAULTS)] },
  component: function StatementsScreen() {
    const params = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <StatementListScreen
        params={params}
        onParamsChange={(next) => void navigate({ search: next, replace: true })}
        lead={<StatementArrearsSummary />}
      />
    )
  },
})
