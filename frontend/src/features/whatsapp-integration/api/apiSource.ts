import { COMPANY_ID_HEADER, unwrap, type ApiClient } from '@leaseguard/api-client'

import type { WhatsAppIntegrationSource } from './source'

/** The WhatsApp integration status from the LeaseGuard API (`/api/v1/integrations/whatsapp/…`). */
export function createApiWhatsAppIntegrationSource(api: ApiClient): WhatsAppIntegrationSource {
  return {
    getCapabilities() {
      return unwrap(api.GET('/api/v1/integrations/whatsapp/capabilities'))
    },
    listBusinessAccounts(companyId) {
      return unwrap(api.GET('/api/v1/integrations/whatsapp/business-accounts', { headers: { [COMPANY_ID_HEADER]: companyId } }))
    },
  }
}
