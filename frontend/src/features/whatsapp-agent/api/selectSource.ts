import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiAgentSource } from './apiSource'
import type { AgentSource } from './source'

/** The AI agent source: the LeaseGuard API, created on first use. */
export const getAgentSource: () => AgentSource = lazySource(() => createApiAgentSource(getApiClient()))
