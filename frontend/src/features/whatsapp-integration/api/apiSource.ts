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
    startOnboarding(companyId) {
      return unwrap(api.POST('/api/v1/integrations/whatsapp/onboarding-sessions', { headers: { [COMPANY_ID_HEADER]: companyId } }))
    },
    completeOnboarding(companyId, sessionId, completion) {
      return unwrap(
        api.POST('/api/v1/integrations/whatsapp/onboarding-sessions/{sessionId}/complete', {
          params: { path: { sessionId } },
          headers: { [COMPANY_ID_HEADER]: companyId },
          body: completion,
        }),
      )
    },
    listMessageTemplates(companyId) {
      return unwrap(api.GET('/api/v1/integrations/whatsapp/message-templates', { headers: { [COMPANY_ID_HEADER]: companyId } }))
    },
    verifyNumber(companyId, numberId) {
      return unwrap(
        api.POST('/api/v1/integrations/whatsapp/numbers/{numberId}/verify', {
          params: { path: { numberId } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },
    registerNumber(companyId, numberId, pin) {
      return unwrap(
        api.POST('/api/v1/integrations/whatsapp/numbers/{numberId}/register', {
          params: { path: { numberId } },
          headers: { [COMPANY_ID_HEADER]: companyId },
          body: { pin },
        }),
      )
    },
    disconnectNumber(companyId, numberId) {
      return unwrap(
        api.POST('/api/v1/integrations/whatsapp/numbers/{numberId}/disconnect', {
          params: { path: { numberId } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },
  }
}
