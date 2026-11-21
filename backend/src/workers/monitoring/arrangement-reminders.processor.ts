import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { type ArrangementInstallment, type ArrangementStatementFigures, type EntityId, isValidISODate } from '@leaseguard/domain'
import { UnrecoverableError } from 'bullmq'

import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import type { JobPayloads } from '../../infrastructure/queues/queue-registry'
import { ProcessorRuntime } from '../jobs/processor-runtime'
import { chunk, fetchAll } from '../shared/db'
import { MonitoringOutputs } from '../shared/monitoring-outputs'
import { loadMonitoringSettings } from '../shared/monitoring-settings'
import { arrangementFindings, type ReminderArrangement } from './arrangement-reminders.findings'
import { loadRecordNames } from './monitoring-data'

export interface ArrangementScanSummary {
  overdue: number
  shortOnStatement: number
  created: number
  notified: number
  skipped?: 'company_inactive'
}

/**
 * Daily instalment scan for one company: overdue instalments, and instalments a verified statement shows were not
 * covered, become 'arrangement_attention' events and upcoming ones a notification to the property manager. No tenant is messaged and no instalment
 * status is changed (see arrangementFindings).
 */
@Injectable()
export class ArrangementRemindersProcessor implements OnModuleInit {
  private readonly logger = new Logger(ArrangementRemindersProcessor.name)

  constructor(
    private readonly runtime: ProcessorRuntime,
    private readonly clients: ServiceRoleClientFactory,
  ) {}

  onModuleInit(): void {
    this.runtime.start('arrangement-reminders', (payload) => this.scan(payload))
  }

  async scan({ companyId, asOf }: JobPayloads['arrangement-reminders']): Promise<ArrangementScanSummary> {
    if (!isValidISODate(asOf)) throw new UnrecoverableError(`Invalid asOf date "${asOf}"`)
    const db = this.clients.get()
    const settings = await loadMonitoringSettings(db, companyId, (type, reason) =>
      this.logger.warn({ companyId, eventType: type, reason }, 'Ignoring invalid monitoring rule config'),
    )
    if (!settings) return { overdue: 0, shortOnStatement: 0, created: 0, notified: 0, skipped: 'company_inactive' }

    const [arrangementRows, names] = await Promise.all([
      fetchAll('Load active payment arrangements', (from, to) =>
        db
          .from('payment_arrangements')
          .select('id, tenant_id, property_id, unit_id, lease_id, status, agreed_on, closed_on')
          .eq('company_id', companyId)
          .eq('status', 'active')
          .order('id')
          .range(from, to),
      ),
      loadRecordNames(db, companyId),
    ])

    const instalments = new Map<EntityId, ArrangementInstallment[]>()
    for (const ids of chunk(arrangementRows.map((row) => row.id), 100)) {
      const rows = await fetchAll('Load arrangement instalments', (from, to) =>
        db
          .from('arrangement_installments')
          .select('id, arrangement_id, sequence, due_date, amount, status, reminder_sent_at, confirmed_by_user_id, confirmed_on, notes')
          .eq('company_id', companyId)
          .in('arrangement_id', ids)
          .order('id')
          .range(from, to),
      )
      for (const row of rows) {
        const list = instalments.get(row.arrangement_id) ?? []
        list.push({
          id: row.id,
          arrangementId: row.arrangement_id,
          sequence: row.sequence,
          dueDate: row.due_date,
          amount: row.amount,
          status: row.status,
          ...(row.reminder_sent_at ? { reminderSentAt: row.reminder_sent_at } : {}),
          ...(row.confirmed_by_user_id ? { confirmedByUserId: row.confirmed_by_user_id } : {}),
          ...(row.confirmed_on ? { confirmedOn: row.confirmed_on } : {}),
          ...(row.notes ? { notes: row.notes } : {}),
        })
        instalments.set(row.arrangement_id, list)
      }
    }

    // Verified statements of the arrangements' leases (only their figures and period), to flag uncovered instalments.
    const statements: ArrangementStatementFigures[] = []
    for (const leaseIds of chunk([...new Set(arrangementRows.map((row) => row.lease_id))], 100)) {
      const rows = await fetchAll('Load verified statements of arrangement leases', (from, to) =>
        db
          .from('statements')
          .select('id, lease_id, status, statement_date, period_start, period_end, rental_charged, additional_charges, payments_received')
          .eq('company_id', companyId)
          .eq('status', 'verified')
          .in('lease_id', leaseIds)
          .order('id')
          .range(from, to),
      )
      for (const row of rows) {
        statements.push({
          id: row.id,
          status: row.status,
          ...(row.statement_date ? { statementDate: row.statement_date } : {}),
          ...(row.period_start ? { periodStart: row.period_start } : {}),
          ...(row.period_end ? { periodEnd: row.period_end } : {}),
          ...(row.lease_id ? { leaseId: row.lease_id } : {}),
          ...(row.rental_charged === null ? {} : { rentalCharged: row.rental_charged }),
          ...(row.additional_charges === null ? {} : { additionalCharges: row.additional_charges }),
          ...(row.payments_received === null ? {} : { paymentsReceived: row.payments_received }),
        })
      }
    }

    const arrangements: ReminderArrangement[] = arrangementRows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      propertyId: row.property_id,
      unitId: row.unit_id,
      leaseId: row.lease_id,
      status: row.status,
      agreedOn: row.agreed_on,
      ...(row.closed_on ? { closedOn: row.closed_on } : {}),
      installments: (instalments.get(row.id) ?? []).sort((a, b) => a.sequence - b.sequence),
    }))

    const { overdue, shortOnStatement, upcoming } = arrangementFindings({ arrangements, settings, names, asOf, statements })
    const outputs = new MonitoringOutputs(db, companyId)
    const raised = await outputs.raise([...overdue, ...shortOnStatement])
    const upcomingNotified = await outputs.notify(upcoming)
    const summary = {
      overdue: overdue.length,
      shortOnStatement: shortOnStatement.length,
      created: raised.created,
      notified: raised.notified + upcomingNotified,
    }
    this.logger.log({ companyId, asOf, arrangements: arrangements.length, upcoming: upcoming.length, ...summary }, 'Arrangement scan complete')
    return summary
  }
}
