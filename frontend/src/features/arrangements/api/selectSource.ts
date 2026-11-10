import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiArrangementSource } from './apiSource'
import type { ArrangementSource } from './source'

/** The payment arrangement source: the LeaseGuard API, created on first use. */
export const getArrangementSource: () => ArrangementSource = lazySource(() => createApiArrangementSource(getApiClient()))
