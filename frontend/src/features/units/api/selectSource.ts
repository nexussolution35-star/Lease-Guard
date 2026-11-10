import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiUnitSource } from './apiSource'
import type { UnitSource } from './source'

/** The unit source: the LeaseGuard API, created on first use. */
export const getUnitSource: () => UnitSource = lazySource(() => createApiUnitSource(getApiClient()))
