import type { Tenant, TenantCommunicationBlocker } from '@leaseguard/domain'

import type { Tone } from '@/lib/labels'

export interface WhatsAppNumberStatus {
  label: 'Validated' | 'Not validated' | 'Opted out'
  tone: Tone
}

/**
 * How a tenant's WhatsApp number reads in lists: opted out wins (no messages at all), then whether the
 * number has been validated (automated communication stays off until it is).
 */
export function whatsappNumberStatus(tenant: Pick<Tenant, 'whatsappVerified' | 'whatsappOptedOut'>): WhatsAppNumberStatus {
  if (tenant.whatsappOptedOut) return { label: 'Opted out', tone: 'neutral' }
  return tenant.whatsappVerified ? { label: 'Validated', tone: 'success' } : { label: 'Not validated', tone: 'warning' }
}

/** Why automated reminders are off, in the words the tenant page uses, for each blocker `tenantCommunicationBlockers` names. */
export const REMINDER_BLOCKER_COPY: Readonly<Record<TenantCommunicationBlocker, string>> = {
  whatsapp_not_validated:
    'The WhatsApp number has not been validated. Statements and payment reminders are sent only to a number a property manager has confirmed with the tenant.',
  whatsapp_opted_out: 'The tenant opted out of WhatsApp messages.',
  vacated: 'The tenant has vacated.',
  prospective: 'The tenant is prospective: reminders start once its lease is in place.',
}
