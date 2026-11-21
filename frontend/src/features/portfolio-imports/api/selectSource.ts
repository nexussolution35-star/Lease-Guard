import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiPortfolioImportSource } from './apiSource'
import type { PortfolioImportSource } from './source'

/** The portfolio import source: the LeaseGuard API, created on first use. */
export const getPortfolioImportSource: () => PortfolioImportSource = lazySource(() => createApiPortfolioImportSource(getApiClient()))
