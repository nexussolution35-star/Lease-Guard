import { createHash } from 'node:crypto'

import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  PORTFOLIO_IMPORT_ROW_RESULTS,
  applicablePortfolioImportMapping,
  portfolioImportFieldsFor,
  portfolioImportHeaderSignature,
  portfolioImportMappingProblems,
  suggestPortfolioImportMapping,
  type EntityId,
  type PortfolioImportColumnMapping,
  type PortfolioImportMapping,
  type PortfolioImportMappingSource,
  type PortfolioImportPreview,
  type PortfolioImportFieldKey,
  type PortfolioImportResultCounts,
  type PortfolioImportRowChange,
  type PortfolioImportRowCheck,
  type PortfolioImportScope,
} from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase } from '../../../common/http/database-errors'
import { fetchAllRows } from '../../../common/http/fetch-all'
import type { Json, Tables } from '../../../infrastructure/database/database.types'
import type { DbClient } from '../../../infrastructure/database/rls-client.factory'
import {
  checkPortfolioRows,
  type ExistingProperty,
  type ExistingTenant,
  type ExistingUnit,
  type ResolvedSourceRow,
  type StoredRowResolution,
} from './check-rows'
import {
  portfolioImportColumnMappingSchema,
  portfolioImportCorrectionsSchema,
  type PortfolioImportPreviewQuery,
} from './portfolio-import-preview.schemas'

type BatchRow = Tables<'portfolio_imports'>

/** The SHA-256 (hex) a saved mapping is filed under: the batch's headings, normalised, in file order. */
export function headerSignatureHash(columns: readonly string[]): string {
  return createHash('sha256').update(portfolioImportHeaderSignature(columns)).digest('hex')
}

/** A stored mapping read back; anything that is not a mapping reads as none. */
function storedMapping(value: Json | null): PortfolioImportColumnMapping | undefined {
  if (value === null) return undefined
  const parsed = portfolioImportColumnMappingSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Stored corrections read back: string values of known fields only. */
function storedCorrections(value: Json): StoredRowResolution['corrections'] {
  const parsed = portfolioImportCorrectionsSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

const PROPERTY_COLUMNS =
  'id, code, name, type, status, address_line1, address_line2, suburb, city, province, postal_code, gross_lettable_area_sqm' as const
const UNIT_COLUMNS = 'id, property_id, unit_number, type, floor_area_sqm, occupancy_status' as const
const TENANT_COLUMNS = 'id, trading_name, legal_name, registration_number, account_reference' as const

/**
 * Column mappings and the row preview of portfolio import batches (tickets I-02, I-05). The mapping a batch is read with
 * is the one applied to it, else the company's saved mapping for the same headings, else the one suggested from the
 * headings. The preview checks every row against the live properties, units and tenants on each request; nothing is
 * written to them. Every query runs with the caller's RLS-bound client and filters by company explicitly.
 */
@Injectable()
export class PortfolioImportPreviewService {
  async getMapping(db: DbClient, companyId: EntityId, importId: EntityId): Promise<PortfolioImportMapping> {
    const batch = await this.batch(db, companyId, importId)
    return this.describe(batch, await this.effectiveMapping(db, batch))
  }

  /**
   * Applies `mapping` to the batch and saves it for the next file with the same headings. Refused with 422 when a
   * column is not the batch's, is chosen twice, or a field is not imported in the batch's scope.
   */
  async saveMapping(db: DbClient, companyId: EntityId, importId: EntityId, mapping: PortfolioImportColumnMapping): Promise<PortfolioImportMapping> {
    const batch = await this.batch(db, companyId, importId)
    const scope = batch.scope as PortfolioImportScope
    const problems = portfolioImportMappingProblems(mapping, batch.columns, scope)
    if (problems.length > 0) throw new UnprocessableEntityException(problems)

    const saved = unwrapDatabase(
      await db.rpc('save_portfolio_import_mapping', {
        p_company_id: companyId,
        p_import_id: importId,
        p_header_signature: headerSignatureHash(batch.columns),
        p_mapping: applicablePortfolioImportMapping(mapping, batch.columns, scope) as Json,
      }),
      'Save portfolio import mapping',
      { P0002: () => new NotFoundException('The record was not found') },
    )
    return this.describe(saved, { source: 'applied', mapping: storedMapping(saved.column_mapping) ?? {} })
  }

  /** Every row checked with the batch's mapping; the page holds the rows with `query.result` when given. */
  async preview(db: DbClient, companyId: EntityId, importId: EntityId, query: PortfolioImportPreviewQuery): Promise<PortfolioImportPreview> {
    const batch = await this.batch(db, companyId, importId)
    const checked = await this.checkAll(db, batch)

    const counts = Object.fromEntries(PORTFOLIO_IMPORT_ROW_RESULTS.map((result) => [result, 0])) as PortfolioImportResultCounts
    for (const row of checked) counts[row.result] += 1
    const filtered = query.result ? checked.filter((row) => row.result === query.result) : checked
    const from = (query.page - 1) * query.pageSize
    return {
      importId,
      counts,
      items: filtered.slice(from, from + query.pageSize),
      total: filtered.length,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  /**
   * Corrects, skips or links one row of the batch (ticket I-03), or records the manager's decision on its suggested
   * tenants (ticket I-05: confirmed as an existing tenant, or rejected), and returns the row checked again. The change is kept on
   * the batch row, never on a property or unit; the database stamps who made it and audits the previous and new values.
   * When the batch is still read with a saved or suggested mapping, that mapping is applied to it first, so a
   * correction's previous value is the file's cell under the mapping the manager saw. Refused with 422 for a field not
   * imported in the batch's scope, or a property or unit that is not in the workspace, not of the linked property, or
   * (for a units import) not of its property.
   */
  async changeRow(db: DbClient, companyId: EntityId, importId: EntityId, rowNumber: number, change: PortfolioImportRowChange): Promise<PortfolioImportRowCheck> {
    let batch = await this.batch(db, companyId, importId)
    const scope = batch.scope as PortfolioImportScope
    const allowed = new Set(portfolioImportFieldsFor(scope).map((field) => field.key))
    const outOfScope = Object.keys(change.corrections ?? {}).filter((field) => !allowed.has(field as PortfolioImportFieldKey))
    if (outOfScope.length > 0) {
      throw new UnprocessableEntityException(outOfScope.map((field) => `${field} is not imported when adding units to one property`))
    }

    const { data: current, error } = await db
      .from('portfolio_import_rows')
      .select('corrections')
      .eq('company_id', companyId)
      .eq('import_id', importId)
      .eq('row_number', rowNumber)
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Get portfolio import row')
    if (!current) throw new NotFoundException('The row was not found')

    const update: {
      corrections?: NonNullable<Json>
      skipped?: boolean
      linked_property_id?: string | null
      linked_unit_id?: string | null
      linked_tenant_id?: string | null
      tenant_suggestions_rejected?: boolean
    } = {}
    if (change.corrections) {
      const corrections = { ...storedCorrections(current.corrections) }
      for (const [field, value] of Object.entries(change.corrections) as [PortfolioImportFieldKey, string | null | undefined][]) {
        if (value === null) delete corrections[field]
        else if (value !== undefined) corrections[field] = value.trim()
      }
      update.corrections = corrections as NonNullable<Json>
    }
    if (change.skipped !== undefined) update.skipped = change.skipped
    if (change.link !== undefined) Object.assign(update, await this.linkColumns(db, companyId, batch, change.link))
    if (change.tenantMatch !== undefined) Object.assign(update, await this.tenantMatchColumns(db, companyId, change.tenantMatch))
    if (Object.keys(update).length === 0) throw new UnprocessableEntityException('Say what to change: corrections, skipped, link or tenantMatch')

    if (change.corrections && !storedMapping(batch.column_mapping)) {
      const { mapping } = await this.effectiveMapping(db, batch)
      batch = unwrapDatabase(
        await db.rpc('save_portfolio_import_mapping', {
          p_company_id: companyId,
          p_import_id: importId,
          p_header_signature: headerSignatureHash(batch.columns),
          p_mapping: mapping as Json,
        }),
        'Apply portfolio import mapping',
        { P0002: () => new NotFoundException('The record was not found') },
      )
    }

    const updated = unwrapDatabase(
      await db
        .from('portfolio_import_rows')
        .update(update)
        .eq('company_id', companyId)
        .eq('import_id', importId)
        .eq('row_number', rowNumber)
        .select('row_number')
        .maybeSingle(),
      'Change portfolio import row',
    )
    const checked = (await this.checkAll(db, batch)).find((row) => row.rowNumber === updated.row_number)
    if (!checked) throw new NotFoundException('The row was not found')
    return checked
  }

  /** The link columns for `link`: a unit alone implies its property in a properties import; null removes the link. */
  private async linkColumns(
    db: DbClient,
    companyId: EntityId,
    batch: BatchRow,
    link: PortfolioImportRowChange['link'],
  ): Promise<{ linked_property_id: string | null; linked_unit_id: string | null }> {
    if (!link || (!link.propertyId && !link.unitId)) return { linked_property_id: null, linked_unit_id: null }
    if (batch.scope === 'units' && link.propertyId) {
      throw new UnprocessableEntityException('This import adds units to one property: link the row to one of its units')
    }

    let propertyId = link.propertyId ?? null
    if (link.unitId) {
      const { data: unit, error } = await db.from('units').select('property_id').eq('company_id', companyId).eq('id', link.unitId).maybeSingle()
      if (error) throw httpErrorFromDatabase(error, 'Load unit to link')
      if (!unit) throw new UnprocessableEntityException('unitId does not name a unit in this workspace')
      const expected = batch.scope === 'units' ? batch.property_id : (propertyId ?? unit.property_id)
      if (unit.property_id !== expected) throw new UnprocessableEntityException('The unit is not one of the property linked to the row')
      if (batch.scope === 'properties') propertyId = unit.property_id
    }
    if (propertyId && !link.unitId) {
      const { data: property, error } = await db.from('properties').select('id').eq('company_id', companyId).eq('id', propertyId).maybeSingle()
      if (error) throw httpErrorFromDatabase(error, 'Load property to link')
      if (!property) throw new UnprocessableEntityException('propertyId does not name a property in this workspace')
    }
    return { linked_property_id: batch.scope === 'units' ? null : propertyId, linked_unit_id: link.unitId ?? null }
  }

  /**
   * The tenant decision columns: a confirmation names a tenant of the workspace (422 otherwise) and withdraws a
   * rejection; a rejection withdraws a confirmation; null withdraws both.
   */
  private async tenantMatchColumns(
    db: DbClient,
    companyId: EntityId,
    match: PortfolioImportRowChange['tenantMatch'],
  ): Promise<{ linked_tenant_id: string | null; tenant_suggestions_rejected: boolean }> {
    if (!match) return { linked_tenant_id: null, tenant_suggestions_rejected: false }
    if (match.decision === 'rejected') return { linked_tenant_id: null, tenant_suggestions_rejected: true }
    if (!match.tenantId) throw new UnprocessableEntityException('Confirm with the tenantId of the existing tenant')
    const { data: tenant, error } = await db.from('tenants').select('id').eq('company_id', companyId).eq('id', match.tenantId).maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Load tenant to confirm')
    if (!tenant) throw new UnprocessableEntityException('tenantId does not name a tenant in this workspace')
    return { linked_tenant_id: tenant.id, tenant_suggestions_rejected: false }
  }

  /** Every row of the batch checked with its mapping and what the manager changed, against the live records. */
  async checkAll(db: DbClient, batch: BatchRow): Promise<PortfolioImportRowCheck[]> {
    const scope = batch.scope as PortfolioImportScope
    const [{ mapping }, rows, properties, tenants, createdTenants] = await Promise.all([
      this.effectiveMapping(db, batch),
      this.rows(db, batch.company_id, batch.id),
      this.properties(db, batch.company_id, batch.property_id),
      this.tenants(db, batch.company_id),
      this.createdTenants(db, batch.company_id, batch.id),
    ])
    const units = await this.units(db, batch.company_id, batch.property_id)
    return checkPortfolioRows({
      scope,
      ...(batch.property_id ? { propertyId: batch.property_id } : {}),
      columns: batch.columns,
      mapping,
      rows,
      properties,
      units,
      tenants,
      createdTenants,
    })
  }

  /** The batch of the company; 404 when it is not one of the company's. */
  async batch(db: DbClient, companyId: EntityId, importId: EntityId): Promise<BatchRow> {
    return unwrapDatabase(
      await db.from('portfolio_imports').select('*').eq('company_id', companyId).eq('id', importId).maybeSingle(),
      'Get portfolio import',
    )
  }

  private async effectiveMapping(db: DbClient, batch: BatchRow): Promise<{ source: PortfolioImportMappingSource; mapping: PortfolioImportColumnMapping; savedAt?: string }> {
    const scope = batch.scope as PortfolioImportScope
    const applied = storedMapping(batch.column_mapping)
    if (applied) return { source: 'applied', mapping: applicablePortfolioImportMapping(applied, batch.columns, scope) }

    const { data: saved, error } = await db
      .from('portfolio_import_mappings')
      .select('column_mapping, saved_at')
      .eq('company_id', batch.company_id)
      .eq('scope', batch.scope)
      .eq('header_signature', headerSignatureHash(batch.columns))
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Get saved portfolio import mapping')
    const savedMapping = saved ? storedMapping(saved.column_mapping) : undefined
    if (saved && savedMapping) {
      return { source: 'saved', mapping: applicablePortfolioImportMapping(savedMapping, batch.columns, scope), savedAt: saved.saved_at }
    }
    return { source: 'suggested', mapping: suggestPortfolioImportMapping(batch.columns, scope) }
  }

  private describe(
    batch: BatchRow,
    { source, mapping, savedAt }: { source: PortfolioImportMappingSource; mapping: PortfolioImportColumnMapping; savedAt?: string },
  ): PortfolioImportMapping {
    const scope = batch.scope as PortfolioImportScope
    const suggested = suggestPortfolioImportMapping(batch.columns, scope)
    return {
      importId: batch.id,
      source,
      fields: portfolioImportFieldsFor(scope).map((field) => {
        const column = mapping[field.key]
        const suggestedColumn = suggested[field.key]
        return { field: field.key, ...(column !== undefined ? { column } : {}), ...(suggestedColumn !== undefined ? { suggestedColumn } : {}) }
      }),
      ...(savedAt ? { savedAt } : {}),
    }
  }

  private async rows(db: DbClient, companyId: EntityId, importId: EntityId): Promise<ResolvedSourceRow[]> {
    const rows = await fetchAllRows('List portfolio import rows', (from, to) =>
      db
        .from('portfolio_import_rows')
        .select(
          'row_number, cells, corrections, skipped, linked_property_id, linked_unit_id, linked_tenant_id, tenant_suggestions_rejected, changed_by_user_id, changed_at',
        )
        .eq('company_id', companyId)
        .eq('import_id', importId)
        .order('row_number', { ascending: true })
        .range(from, to),
    )
    return rows.map((row) => ({
      rowNumber: row.row_number,
      cells: Array.isArray(row.cells) ? row.cells.map((cell) => (typeof cell === 'string' ? cell : cell === null ? '' : String(cell))) : [],
      ...(row.changed_at
        ? {
            resolution: {
              corrections: storedCorrections(row.corrections),
              skipped: row.skipped,
              ...(row.linked_property_id ? { linkedPropertyId: row.linked_property_id } : {}),
              ...(row.linked_unit_id ? { linkedUnitId: row.linked_unit_id } : {}),
              ...(row.linked_tenant_id ? { linkedTenantId: row.linked_tenant_id } : {}),
              tenantSuggestionsRejected: row.tenant_suggestions_rejected,
              ...(row.changed_by_user_id ? { changedByUserId: row.changed_by_user_id } : {}),
              changedAt: row.changed_at,
            } satisfies StoredRowResolution,
          }
        : {}),
    }))
  }

  /** The company's properties; for a units batch only its property. */
  private async properties(db: DbClient, companyId: EntityId, propertyId: string | null): Promise<ExistingProperty[]> {
    const rows = await fetchAllRows('List properties for import', (from, to) => {
      let request = db.from('properties').select(PROPERTY_COLUMNS).eq('company_id', companyId)
      if (propertyId) request = request.eq('id', propertyId)
      return request.order('id', { ascending: true }).range(from, to)
    })
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      status: row.status,
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      suburb: row.suburb,
      city: row.city,
      province: row.province,
      postalCode: row.postal_code,
      grossLettableAreaSqm: row.gross_lettable_area_sqm,
    }))
  }

  /** The company's tenants, which a row's tenant is matched against (a units batch's tenants may lease anywhere). */
  private async tenants(db: DbClient, companyId: EntityId): Promise<ExistingTenant[]> {
    const rows = await fetchAllRows('List tenants for import', (from, to) =>
      db.from('tenants').select(TENANT_COLUMNS).eq('company_id', companyId).order('id', { ascending: true }).range(from, to),
    )
    return rows.map((row) => ({
      id: row.id,
      tradingName: row.trading_name,
      legalName: row.legal_name,
      registrationNumber: row.registration_number,
      accountReference: row.account_reference,
    }))
  }

  /** The tenant an earlier approval of the batch created from each row: a row never creates its tenant twice. */
  private async createdTenants(db: DbClient, companyId: EntityId, importId: EntityId): Promise<Map<number, EntityId>> {
    const rows = await fetchAllRows('List tenants created by the import', (from, to) =>
      db
        .from('portfolio_import_records')
        .select('id, row_number, tenant_id')
        .eq('company_id', companyId)
        .eq('import_id', importId)
        .eq('record_type', 'tenant')
        .order('id', { ascending: true })
        .range(from, to),
    )
    return new Map(rows.flatMap((row) => (row.tenant_id ? [[row.row_number, row.tenant_id] as const] : [])))
  }

  /** The company's units; for a units batch only those of its property. */
  private async units(db: DbClient, companyId: EntityId, propertyId: string | null): Promise<ExistingUnit[]> {
    const rows = await fetchAllRows('List units for import', (from, to) => {
      let request = db.from('units').select(UNIT_COLUMNS).eq('company_id', companyId)
      if (propertyId) request = request.eq('property_id', propertyId)
      return request.order('id', { ascending: true }).range(from, to)
    })
    return rows.map((row) => ({
      id: row.id,
      propertyId: row.property_id,
      unitNumber: row.unit_number,
      type: row.type,
      floorAreaSqm: row.floor_area_sqm,
      occupancyStatus: row.occupancy_status,
    }))
  }
}
