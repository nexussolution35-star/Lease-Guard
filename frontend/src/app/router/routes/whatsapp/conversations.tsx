import { createFileRoute, stripSearchParams } from '@tanstack/react-router'

import { ConversationsInbox } from '@/features/whatsapp-conversations/components/ConversationsInbox'
import { INBOX_DEFAULTS, inboxSearchSchema } from '@/features/whatsapp-conversations/inboxSearch'

export const Route = createFileRoute('/whatsapp/conversations')({
  validateSearch: inboxSearchSchema,
  search: { middlewares: [stripSearchParams(INBOX_DEFAULTS)] },
  component: function WhatsAppConversationsScreen() {
    const params = Route.useSearch()
    const navigate = Route.useNavigate()
    return <ConversationsInbox params={params} onParamsChange={(next) => void navigate({ search: next, replace: true })} />
  },
})
