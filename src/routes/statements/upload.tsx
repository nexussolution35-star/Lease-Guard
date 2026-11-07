import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/statements/upload')({
  component: function StatementUploadScreen() {
    return <ScreenPlaceholder title="Upload statements" description="Upload statement PDFs for extraction and review." />
  },
})
