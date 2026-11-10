import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiConversationSource } from './apiSource'
import type { ConversationSource } from './source'

/** The conversations source: the LeaseGuard API, created on first use. */
export const getConversationSource: () => ConversationSource = lazySource(() => createApiConversationSource(getApiClient()))
