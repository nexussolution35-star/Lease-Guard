import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiAuditSource } from './apiSource'
import type { AuditSource } from './source'

/** The audit source: the LeaseGuard API, created on first use. */
export const getAuditSource: () => AuditSource = lazySource(() => createApiAuditSource(getApiClient()))
