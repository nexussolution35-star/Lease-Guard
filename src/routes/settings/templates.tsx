import { createFileRoute } from '@tanstack/react-router'

import { ScreenPlaceholder } from '@/components/layout'

export const Route = createFileRoute('/settings/templates')({
  component: function TemplatesSettingsScreen() {
    return <ScreenPlaceholder title="Message templates" description="Approved templates for tenant and owner messages." />
  },
})
