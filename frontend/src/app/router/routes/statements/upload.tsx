import { createFileRoute } from '@tanstack/react-router'

import { StatementUploadScreen } from '@/features/statements/components/StatementUploadScreen'

export const Route = createFileRoute('/statements/upload')({
  component: StatementUploadScreen,
})
