import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiDashboardSource } from './apiSource'
import type { DashboardSource } from './source'

/** The dashboard source: the LeaseGuard API, created on first use. */
export const getDashboardSource: () => DashboardSource = lazySource(() => createApiDashboardSource(getApiClient()))
