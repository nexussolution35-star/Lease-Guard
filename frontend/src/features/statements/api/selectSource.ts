import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiStatementSource } from './apiSource'
import type { StatementSource } from './source'

/** The statement source: the LeaseGuard API, created on first use. */
export const getStatementSource: () => StatementSource = lazySource(() => createApiStatementSource(getApiClient()))
