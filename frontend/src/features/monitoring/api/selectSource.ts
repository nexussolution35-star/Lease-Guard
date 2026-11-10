import { lazySource } from '@/lib/data/dataSource'
import { getApiClient } from '@/services/api/client'

import { createApiMonitoringEventSource } from './apiSource'
import type { MonitoringEventSource } from './source'

/** The monitoring event source: the LeaseGuard API, created on first use. */
export const getMonitoringEventSource: () => MonitoringEventSource = lazySource(() => createApiMonitoringEventSource(getApiClient()))
