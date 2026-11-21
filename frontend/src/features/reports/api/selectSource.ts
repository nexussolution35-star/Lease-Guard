import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiReportsSource } from './apiSource'
import type { ReportsSource } from './source'

/** The reports source: the reports service through the gateway, created on first use. */
export const getReportsSource: () => ReportsSource = lazySource(() => createApiReportsSource(getApiClient()))
