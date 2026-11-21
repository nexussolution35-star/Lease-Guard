import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import type { EntityId, ISODate } from '@leaseguard/domain'

import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { ProcessorRuntime } from '../jobs/processor-runtime'
import { Clock } from '../shared/clock'
import { WorkerDatabaseError } from '../shared/db'
import { ArrearsMonitoringProcessor } from './arrears-monitoring.processor'
import { LeaseMonitoringProcessor } from './lease-monitoring.processor'
import type { ScanSummary } from './monitoring-data'

export type StatementMonitoringResult =
  | { skipped: 'not_verified' }
  | { tenantId: EntityId; asOf: ISODate; arrears: ScanSummary & { suppressed: number }; leases: ScanSummary }

/**
 * Monitoring for the tenant of a statement that was just verified: the arrears scan (its balance, honouring active
 * payment arrangements) and the lease scan (escalation discrepancies against the billed rental, with the tenant's
 * other lease findings), both limited to that tenant and as of today in South Africa. The daily scans would raise the
 * same findings; their dedupe keys make running both harmless. A statement that is no longer verified is skipped.
 */
@Injectable()
export class StatementMonitoringProcessor implements OnModuleInit {
  private readonly logger = new Logger(StatementMonitoringProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
    private readonly clock: Clock,
    private readonly arrears: ArrearsMonitoringProcessor,
    private readonly leases: LeaseMonitoringProcessor,
  ) {}

  onModuleInit(): void {
    this.runtime.start('statement-monitoring', (payload) => this.run(payload))
  }

  async run({ companyId, statementId }: JobPayloads['statement-monitoring']): Promise<StatementMonitoringResult> {
    const { data: statement, error } = await this.clients
      .get()
      .from('statements')
      .select('id, status, tenant_id')
      .eq('company_id', companyId)
      .eq('id', statementId)
      .maybeSingle()
    if (error) throw new WorkerDatabaseError('Load verified statement', error)
    if (!statement || statement.status !== 'verified' || !statement.tenant_id) {
      this.logger.warn({ companyId, statementId }, 'Statement is not verified; nothing to monitor')
      return { skipped: 'not_verified' }
    }
    const asOf = this.clock.today()
    const scope = { tenantId: statement.tenant_id }
    const arrears = await this.arrears.scan({ companyId, asOf }, scope)
    const leases = await this.leases.scan({ companyId, asOf }, scope)
    return { tenantId: statement.tenant_id, asOf, arrears, leases }
  }
}
