import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import type { EntityId, PaymentArrangementListItem } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase, type DatabaseErrorOverrides } from '../../common/http/database-errors'
import { fetchAllRows } from '../../common/http/fetch-all'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import {
  ARRANGEMENT_SELECT,
  toPaymentArrangementListItem,
  type ArrangementInstallmentRow,
  type PaymentArrangementNamedRow,
} from './arrangements.mapper'
import {
  ARRANGEMENT_SORT_COLUMNS,
  type ArrangementListQuery,
  type CancelArrangementBody,
  type CloseArrangementBody,
  type CreateArrangementBody,
  type InstallmentOutcomeBody,
  type UpdateArrangementBody,
} from './arrangements.schemas'

const SEARCH_COLUMNS = ['notes'] as const

/**
 * Database answers to the writes, in words for people. 22023 is terms or a lease that do not fit (422); P0001 is a
 * state conflict the database words itself (a second active arrangement, a closed arrangement, a fixed schedule): 409;
 * P0002 is a record not in the company: 404. 42501 (not a writer) keeps the default 403.
 */
const WRITE_ERRORS: DatabaseErrorOverrides = {
  '22023': (error) => new UnprocessableEntityException(error.message),
  P0001: (error) => new ConflictException(error.message),
  P0002: (error) => new NotFoundException(error.message),
}

/**
 * Reads payment arrangements and their instalments for one company, each naming its tenant, property, unit and lease. These are monitoring records of
 * an agreement between tenant and owner or manager; LeaseGuard never collects or processes payments.
 * Queries run through the caller's RLS-bound client and filter by company explicitly.
 */
@Injectable()
export class ArrangementsService {
  async list(db: DbClient, companyId: EntityId, query: ArrangementListQuery): Promise<Page<PaymentArrangementListItem>> {
    const filtered = () => {
      let request = db.from('payment_arrangements').select(ARRANGEMENT_SELECT, { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.leaseId) request = request.eq('lease_id', query.leaseId)
      if (query.tenantId) request = request.eq('tenant_id', query.tenantId)
      if (query.propertyId) request = request.eq('property_id', query.propertyId)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = ARRANGEMENT_SORT_COLUMNS[query.sort ?? 'agreedOn']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List payment arrangements')
      throw httpErrorFromDatabase(error, 'List payment arrangements')
    }

    const items = await this.withInstallments(db, companyId, data ?? [])
    return { items, total: count ?? 0, page: query.page, pageSize: query.pageSize }
  }

  async get(db: DbClient, companyId: EntityId, arrangementId: EntityId): Promise<PaymentArrangementListItem> {
    const row = unwrapDatabase(
      await db.from('payment_arrangements').select(ARRANGEMENT_SELECT).eq('company_id', companyId).eq('id', arrangementId).maybeSingle(),
      'Get payment arrangement',
    )
    const [arrangement] = await this.withInstallments(db, companyId, [row])
    if (!arrangement) throw new NotFoundException('The record was not found')
    return arrangement
  }

  /**
   * Records an arrangement agreed with the tenant (ticket M7-03). The database checks the role and the terms, resolves
   * the lease, refuses a second active arrangement for the tenant, generates the instalment schedule and audits it.
   * While active it suppresses the tenant's normal arrears reminders. No payment is collected.
   */
  async create(db: DbClient, companyId: EntityId, body: CreateArrangementBody): Promise<PaymentArrangementListItem> {
    const id = unwrapDatabase(
      await db.rpc('record_payment_arrangement', {
        p_company_id: companyId,
        p_tenant_id: body.tenantId,
        p_property_id: body.propertyId,
        p_outstanding_balance: body.outstandingBalance,
        p_installment_amount: body.installmentAmount,
        p_frequency: body.frequency,
        p_first_installment_date: body.firstInstallmentDate,
        ...(body.finalInstallmentDate === undefined ? {} : { p_final_installment_date: body.finalInstallmentDate }),
        ...(body.unitId === undefined ? {} : { p_unit_id: body.unitId }),
        ...(body.leaseId === undefined ? {} : { p_lease_id: body.leaseId }),
        ...(body.status === undefined ? {} : { p_status: body.status }),
        ...(body.agreedOn === undefined ? {} : { p_agreed_on: body.agreedOn }),
        ...(body.notes === undefined ? {} : { p_notes: body.notes }),
      }),
      'Record payment arrangement',
      WRITE_ERRORS,
    )
    return this.get(db, companyId, id)
  }

  /** Edits a proposed or active arrangement; changed terms generate the schedule again (refused once an outcome is recorded). */
  async update(db: DbClient, companyId: EntityId, arrangementId: EntityId, body: UpdateArrangementBody): Promise<PaymentArrangementListItem> {
    unwrapDatabase(
      await db.rpc('update_payment_arrangement', {
        p_company_id: companyId,
        p_arrangement_id: arrangementId,
        ...(body.outstandingBalance === undefined ? {} : { p_outstanding_balance: body.outstandingBalance }),
        ...(body.installmentAmount === undefined ? {} : { p_installment_amount: body.installmentAmount }),
        ...(body.frequency === undefined ? {} : { p_frequency: body.frequency }),
        ...(body.firstInstallmentDate === undefined ? {} : { p_first_installment_date: body.firstInstallmentDate }),
        ...(body.finalInstallmentDate === undefined ? {} : { p_final_installment_date: body.finalInstallmentDate }),
        ...(body.agreedOn === undefined ? {} : { p_agreed_on: body.agreedOn }),
        ...(body.status === undefined ? {} : { p_status: body.status }),
        ...(body.notes === undefined ? {} : { p_notes: body.notes }),
      }),
      'Edit payment arrangement',
      WRITE_ERRORS,
    )
    return this.get(db, companyId, arrangementId)
  }

  /** Closes an active arrangement as completed or defaulted; normal arrears reminders resume for the tenant. */
  close(db: DbClient, companyId: EntityId, arrangementId: EntityId, body: CloseArrangementBody): Promise<PaymentArrangementListItem> {
    return this.end(db, companyId, arrangementId, body.outcome, body.reason, 'Close payment arrangement')
  }

  /** Cancels a proposed or active arrangement, with the reason. */
  cancel(db: DbClient, companyId: EntityId, arrangementId: EntityId, body: CancelArrangementBody): Promise<PaymentArrangementListItem> {
    return this.end(db, companyId, arrangementId, 'cancelled', body.reason, 'Cancel payment arrangement')
  }

  /**
   * Records what the property manager confirms happened to an instalment (paid, missed or waived), or clears it.
   * LeaseGuard never verifies a payment; the database stamps who and when and audits it on the arrangement.
   */
  async recordInstallmentOutcome(
    db: DbClient,
    companyId: EntityId,
    arrangementId: EntityId,
    installmentId: EntityId,
    body: InstallmentOutcomeBody,
  ): Promise<PaymentArrangementListItem> {
    unwrapDatabase(
      await db.rpc('record_arrangement_installment_outcome', {
        p_company_id: companyId,
        p_arrangement_id: arrangementId,
        p_installment_id: installmentId,
        p_status: body.outcome,
        ...(body.note === undefined ? {} : { p_note: body.note }),
      }),
      'Record instalment outcome',
      WRITE_ERRORS,
    )
    return this.get(db, companyId, arrangementId)
  }

  private async end(
    db: DbClient,
    companyId: EntityId,
    arrangementId: EntityId,
    status: 'completed' | 'defaulted' | 'cancelled',
    reason: string | undefined,
    operation: string,
  ): Promise<PaymentArrangementListItem> {
    unwrapDatabase(
      await db.rpc('close_payment_arrangement', {
        p_company_id: companyId,
        p_arrangement_id: arrangementId,
        p_status: status,
        ...(reason === undefined || reason === '' ? {} : { p_reason: reason }),
      }),
      operation,
      WRITE_ERRORS,
    )
    return this.get(db, companyId, arrangementId)
  }

  /**
   * Loads the instalments of a page of arrangements (not one query per row). A page can hold more
   * instalments than the Data API returns at once, so they are read page by page.
   */
  private async withInstallments(
    db: DbClient,
    companyId: EntityId,
    rows: readonly PaymentArrangementNamedRow[],
  ): Promise<PaymentArrangementListItem[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const installments = await fetchAllRows('List arrangement instalments', (from, to) =>
      db
        .from('arrangement_installments')
        .select('*')
        .eq('company_id', companyId)
        .in('arrangement_id', ids)
        .order('arrangement_id', { ascending: true })
        .order('sequence', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )

    const byArrangement = new Map<EntityId, ArrangementInstallmentRow[]>()
    for (const installment of installments) {
      const list = byArrangement.get(installment.arrangement_id)
      if (list) list.push(installment)
      else byArrangement.set(installment.arrangement_id, [installment])
    }
    return rows.map((row) => toPaymentArrangementListItem(row, byArrangement.get(row.id) ?? []))
  }
}
