import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiCommunicationSource } from './apiSource'
import type { CommunicationSource } from './source'

/** The communication source: the LeaseGuard API, created on first use. */
export const getCommunicationSource: () => CommunicationSource = lazySource(() => createApiCommunicationSource(getApiClient()))
