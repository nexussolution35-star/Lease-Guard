import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiWhatsAppIntegrationSource } from './apiSource'
import type { WhatsAppIntegrationSource } from './source'

/** The WhatsApp integration source: the LeaseGuard API, created on first use. */
export const getWhatsAppIntegrationSource: () => WhatsAppIntegrationSource = lazySource(() =>
  createApiWhatsAppIntegrationSource(getApiClient()),
)
