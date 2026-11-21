import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiMessageTemplateSource } from './apiSource'
import type { MessageTemplateSource } from './source'

/** The message template source: the LeaseGuard API, created on first use. */
export const getMessageTemplateSource: () => MessageTemplateSource = lazySource(() => createApiMessageTemplateSource(getApiClient()))
