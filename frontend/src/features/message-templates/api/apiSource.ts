import { COMPANY_ID_HEADER, unwrap, type ApiClient } from '@leaseguard/api-client'

import type { MessageTemplateSource } from './source'

/** Message template settings from the LeaseGuard API (`/api/v1/message-templates…`). */
export function createApiMessageTemplateSource(api: ApiClient): MessageTemplateSource {
  return {
    getSettings(companyId) {
      return unwrap(api.GET('/api/v1/message-templates', { headers: { [COMPANY_ID_HEADER]: companyId } }))
    },
    choose(companyId, messageType, whatsappTemplateId) {
      return unwrap(
        api.PUT('/api/v1/message-templates/{messageType}', {
          params: { path: { messageType } },
          headers: { [COMPANY_ID_HEADER]: companyId },
          body: { whatsappTemplateId },
        }),
      )
    },
    sync(companyId) {
      return unwrap(api.POST('/api/v1/message-templates/sync', { headers: { [COMPANY_ID_HEADER]: companyId } }))
    },
  }
}
