import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { approvalsSearchSchema, APPROVALS_DEFAULTS } from '@/features/communications/approvalsSearch'
import { ApprovalsQueue } from '@/features/communications/components/ApprovalsQueue'

export const Route = createFileRoute('/communications/approvals')({
  validateSearch: approvalsSearchSchema,
  search: { middlewares: [stripSearchParams(APPROVALS_DEFAULTS)] },
  component: function ApprovalsScreen() {
    const { page, pageSize } = Route.useSearch()
    const navigate = Route.useNavigate()
    return <ApprovalsQueue page={page} pageSize={pageSize} onPageChange={(next) => void navigate({ search: { page: next, pageSize }, replace: true })} />
  },
})
