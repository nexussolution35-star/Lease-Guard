import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiLeaseSource } from './apiSource'
import type { LeaseSource } from './source'

/** The lease source: the LeaseGuard API, created on first use. */
export const getLeaseSource: () => LeaseSource = lazySource(() => createApiLeaseSource(getApiClient()))
