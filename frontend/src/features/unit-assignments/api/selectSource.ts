import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiUnitAssignmentSource } from './apiSource'
import type { UnitAssignmentSource } from './source'

/** The unit assignment source: the LeaseGuard API, created on first use. */
export const getUnitAssignmentSource: () => UnitAssignmentSource = lazySource(() => createApiUnitAssignmentSource(getApiClient()))
