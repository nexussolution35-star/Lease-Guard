import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/statements/')({
  component: function StatementsScreen() {
    return <ScreenPlaceholder title="Statements" description="Uploaded tenant statements and extraction review status." />
  },
})
