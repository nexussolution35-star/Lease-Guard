import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import type { EntityId, PortfolioImportCreatedRecord, PortfolioImportScope, PortfolioImportSummary, StatementSource } from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../../common/http/database-errors'
import { fetchAllRows } from '../../../common/http/fetch-all'
import type { Json, Tables } from '../../../infrastructure/database/database.types'
import type { DbClient } from '../../../infrastructure/database/rls-client.factory'
import { propertyInsertColumns } from '../../properties/properties.service'
import { tenantInsertFrom } from '../../tenants/tenants.writes'
import { unitInsertColumns } from '../../units/units.service'
import { PortfolioImportPreviewService } from '../preview/portfolio-import-preview.service'
import { plannedPropertyBody, plannedTenantBody, plannedUnitBody, planPortfolioImport, type PortfolioImportPlan } from './plan-import'

type BatchRow = Tables<'portfolio_imports'>

/** Validates a unit whose property the same approval creates; the database puts in the new property's id. */
const PROPERTY_CREATED_BY_THIS_IMPORT = '00000000-0000-4000-8000-000000000000'

/** The created records with their property and unit, named through the composite company-scoped foreign keys (RLS applies). */
const RECORD_SELECT =
  'record_type, row_number, property_id, unit_id, tenant_id, created_at, property:properties!portfolio_import_records_property_fk(name, code), unit:units!portfolio_import_records_unit_fk(unit_number), tenant:tenants!portfolio_import_records_tenant_fk(trading_name)'

export interface ApproveOptions {
  /** The signed-in user approving: the manager of the new properties. */
  userId: EntityId
  accountingSystem?: StatementSource | undefined
}

/**
 * Approving a portfolio import (tickets I-04, I-05). The batch's rows are checked against the live records exactly as
 * the preview checks them; the new properties, units and tenants are held to the property, unit and tenant forms'
 * validation, given the columns the forms (and the tenant write service) insert, and created by one database call
 * (apply_portfolio_import) in one transaction, through the same tables, grants, guards and audit triggers as the forms.
 * Rows still blocked (including tenants whose suggested match waits on the manager) stay out. Importing never enables
 * or sends tenant messaging: a created tenant's WhatsApp number starts unvalidated and nothing is sent. Every query runs with the caller's RLS-bound client and filters by company explicitly.
 */
@Injectable()
export class PortfolioImportApplyService {
  constructor(private readonly preview: PortfolioImportPreviewService) {}

  async summary(db: DbClient, companyId: EntityId, importId: EntityId): Promise<PortfolioImportSummary> {
    const batch = await this.preview.batch(db, companyId, importId)
    return this.describe(db, batch, await this.plan(db, batch))
  }

  /**
   * Creates what the batch adds now and signs the approval off. Approving when nothing is left to create returns the
   * summary unchanged, so approving twice, or importing the same file again, never creates a second copy; a record
   * another approval created meanwhile (unique code or unit number, 23505) is checked again once.
   */
  async approve(db: DbClient, companyId: EntityId, importId: EntityId, options: ApproveOptions): Promise<PortfolioImportSummary> {
    const batch = await this.preview.batch(db, companyId, importId)
    let plan = await this.plan(db, batch)
    for (let attempt = 0; ; attempt += 1) {
      if (plan.properties.length + plan.units.length + plan.tenants.length === 0) return this.describe(db, batch, plan)
      const { error } = await db.rpc('apply_portfolio_import', {
        p_company_id: companyId,
        p_import_id: importId,
        ...this.payload(companyId, plan, options),
      })
      if (!error) break
      if (error.code === '23505' && attempt === 0) {
        plan = await this.plan(db, batch)
        continue
      }
      throw httpErrorFromDatabase(error, 'Apply portfolio import', {
        P0002: () => new NotFoundException('The record was not found'),
        P0001: (failure) => new UnprocessableEntityException(failure.message),
        '23505': () => new ConflictException('Some of these records were added meanwhile. Check the rows again and approve once more.'),
      })
    }
    const applied = await this.preview.batch(db, companyId, importId)
    return this.describe(db, applied, await this.plan(db, applied))
  }

  private async plan(db: DbClient, batch: BatchRow): Promise<PortfolioImportPlan> {
    return planPortfolioImport({
      scope: batch.scope as PortfolioImportScope,
      ...(batch.property_id ? { propertyId: batch.property_id } : {}),
      rows: await this.preview.checkAll(db, batch),
    })
  }

  /** The rows of apply_portfolio_import: the forms' insert columns for each record, with its row. */
  private payload(companyId: EntityId, plan: PortfolioImportPlan, options: ApproveOptions): { p_properties: Json; p_units: Json; p_tenants: Json } {
    if (plan.properties.length > 0 && !options.accountingSystem) {
      throw new UnprocessableEntityException('Choose the accounting system the new properties\' statements come from')
    }
    const problems: string[] = []
    const properties: Json[] = []
    for (const planned of plan.properties) {
      const built = plannedPropertyBody(planned, { managerUserId: options.userId, accountingSystem: options.accountingSystem ?? 'other' })
      if ('problem' in built) problems.push(built.problem)
      else properties.push({ row_number: planned.rowNumber, ...propertyInsertColumns(companyId, built.body) })
    }
    const units: Json[] = []
    for (const planned of plan.units) {
      const built = plannedUnitBody(planned, planned.propertyId ?? PROPERTY_CREATED_BY_THIS_IMPORT)
      if ('problem' in built) {
        problems.push(built.problem)
        continue
      }
      const { property_id, ...columns } = unitInsertColumns(companyId, built.body)
      units.push({
        row_number: planned.rowNumber,
        ...columns,
        property_id: planned.propertyId ? property_id : null,
        property_code: planned.propertyCode ?? null,
      })
    }
    const tenants: Json[] = []
    for (const planned of plan.tenants) {
      const built = plannedTenantBody(planned)
      if ('problem' in built) {
        problems.push(built.problem)
        continue
      }
      tenants.push({
        row_number: planned.rowNumber,
        unit_id: planned.unitId ?? null,
        property_id: planned.propertyId ?? null,
        property_code: planned.propertyCode ?? null,
        unit_number: planned.unitNumber ?? null,
        ...tenantInsertFrom(companyId, built.body),
      })
    }
    if (problems.length > 0) throw new UnprocessableEntityException(problems)
    return { p_properties: properties, p_units: units, p_tenants: tenants }
  }

  private async describe(db: DbClient, batch: BatchRow, plan: PortfolioImportPlan): Promise<PortfolioImportSummary> {
    const records = await fetchAllRows('List portfolio import records', (from, to) =>
      db
        .from('portfolio_import_records')
        .select(RECORD_SELECT)
        .eq('company_id', batch.company_id)
        .eq('import_id', batch.id)
        .order('row_number', { ascending: true })
        .order('record_type', { ascending: true })
        .range(from, to),
    )
    const created = records.map((record): PortfolioImportCreatedRecord => {
      const propertyName = record.property?.name ?? 'A property'
      if (record.record_type === 'tenant' && record.tenant_id) {
        return {
          recordType: 'tenant',
          id: record.tenant_id,
          label: record.tenant?.trading_name ?? 'A tenant',
          propertyId: record.property_id,
          propertyName,
          ...(record.unit_id ? { unitId: record.unit_id } : {}),
          ...(record.unit ? { unitNumber: record.unit.unit_number } : {}),
          rowNumber: record.row_number,
          createdAt: record.created_at,
        }
      }
      return record.record_type === 'unit' && record.unit_id
        ? {
            recordType: 'unit',
            id: record.unit_id,
            label: record.unit?.unit_number ?? 'A unit',
            propertyId: record.property_id,
            propertyName,
            rowNumber: record.row_number,
            createdAt: record.created_at,
          }
        : {
            recordType: 'property',
            id: record.property_id,
            label: record.property ? `${record.property.name} (${record.property.code})` : propertyName,
            propertyId: record.property_id,
            propertyName,
            rowNumber: record.row_number,
            createdAt: record.created_at,
          }
    })
    const propertiesToCreate = plan.properties.length
    return {
      importId: batch.id,
      propertiesToCreate,
      unitsToCreate: plan.units.length,
      tenantsToCreate: plan.tenants.length,
      tenantsLinked: plan.tenantsLinked,
      tenantSuggestionsToReview: plan.tenantSuggestionsToReview,
      missingContactDetails: plan.missingContactDetails,
      linkedRows: plan.linkedRows,
      skippedRows: plan.skippedRows,
      blockedRows: plan.blockedRows,
      canApprove: propertiesToCreate + plan.units.length + plan.tenants.length > 0,
      needsAccountingSystem: propertiesToCreate > 0,
      ...(batch.approved_at
        ? { approval: { ...(batch.approved_by_user_id ? { approvedByUserId: batch.approved_by_user_id } : {}), approvedAt: batch.approved_at } }
        : {}),
      created,
    }
  }
}
