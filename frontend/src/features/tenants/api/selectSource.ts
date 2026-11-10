import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiTenantSource } from './apiSource'
import type { TenantSource } from './source'

/** The tenant source: the LeaseGuard API, created on first use. */
export const getTenantSource: () => TenantSource = lazySource(() => createApiTenantSource(getApiClient()))
