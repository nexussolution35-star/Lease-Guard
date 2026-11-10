import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiPropertySource } from './apiSource'
import type { PropertySource } from './source'

/** The property source: the LeaseGuard API, created on first use. */
export const getPropertySource: () => PropertySource = lazySource(() => createApiPropertySource(getApiClient()))
