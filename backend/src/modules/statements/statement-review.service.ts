import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  leaseChoiceProblem,
  leaseInForceOn,
  parseFieldCorrection,
  statementDateForMatching,
  type EntityId,
  type ExtractedField,
  type ExtractionFieldName,
  type LeaseCandidate,
  type Statement,
  type StatementExtraction,
} from '@leaseguard/domain'

import { conflictWithDatabaseMessage, httpErrorFromDatabase, unwrapDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import type { Tables, TablesUpdate } from '../../infrastructure/database/database.types'
import { StorageService } from '../../infrastructure/storage/storage.service'
import type { SetStatementMatchBody } from './statement-review.schemas'
import { StatementsService } from './statements.service'

/** How long a statement download link works. */
export const STATEMENT_DOWNLOAD_SECONDS = 300

export interface StatementDownloadUrl {
  url: string
  expiresInSeconds: number
}

/** Trigger messages (P0001) are written for users: a closed review answers 409 with the database's words. */
const REVIEW_CLOSED = { P0001: conflictWithDatabaseMessage } as const

type ReviewedStatementRow = Pick<Tables<'statements'>, 'id' | 'status' | 'property_id' | 'statement_date' | 'storage_path'>
type LeaseRow = Pick<Tables<'leases'>, 'id' | 'reference' | 'status' | 'commencement_date' | 'expiry_date' | 'tenant_id' | 'unit_id' | 'property_id'>

const LEASE_COLUMNS = 'id, reference, status, commencement_date, expiry_date, tenant_id, unit_id, property_id'

const toLeaseCandidate = (row: LeaseRow): LeaseCandidate & { row: LeaseRow } => ({
  id: row.id,
  reference: row.reference,
  status: row.status,
  commencementDate: row.commencement_date,
  expiryDate: row.expiry_date,
  row,
})

/**
 * Working through a processed statement: the original file, correcting or confirming each extracted field, and
 * choosing the statement's tenant, unit and lease. Every call runs with the caller's RLS-bound client and an
 * explicit company filter. The database stamps who corrected or confirmed what and when, audits every change with
 * before and after, and refuses changes once the review is closed (guards in 20261121110412_statement_review.sql).
 * Nothing is guessed: a value the extractor did not find is unresolved until someone enters it.
 */
@Injectable()
export class StatementReviewService {
  constructor(
    private readonly statements: StatementsService,
    private readonly storage: StorageService,
  ) {}

  /** A five-minute link to the original file; any member may read it. 404 when the statement is not in the company. */
  async downloadUrl(db: DbClient, companyId: EntityId, statementId: EntityId): Promise<StatementDownloadUrl> {
    const row = await this.statementRow(db, companyId, statementId)
    const url = await this.storage.createSignedDownloadUrl(db, this.storage.statementsBucket, row.storage_path, STATEMENT_DOWNLOAD_SECONDS)
    if (!url) throw new NotFoundException('The statement file was not found')
    return { url, expiresInSeconds: STATEMENT_DOWNLOAD_SECONDS }
  }

  /** Enters the reviewer's value for one field (422 when it is not a valid value for that field). */
  async correctField(db: DbClient, companyId: EntityId, statementId: EntityId, name: ExtractionFieldName, input: unknown): Promise<StatementExtraction> {
    const { extraction, field } = await this.reviewableField(db, companyId, statementId, name)
    const parsed = parseFieldCorrection(name, input)
    if (!parsed.ok) throw new UnprocessableEntityException(parsed.message)
    if (field.correctedValue === parsed.value) return extraction
    await this.updateField(db, companyId, extraction.id, name, { corrected_value: parsed.value })
    return this.statements.getExtraction(db, companyId, statementId)
  }

  /**
   * Confirms the extracted value as correct, dropping any correction. A field the extractor did not find has
   * nothing to confirm (422): its value must be entered. Confirming a confirmed field changes nothing.
   */
  async confirmField(db: DbClient, companyId: EntityId, statementId: EntityId, name: ExtractionFieldName): Promise<StatementExtraction> {
    const { extraction, field } = await this.reviewableField(db, companyId, statementId, name)
    if (field.value === null) {
      throw new UnprocessableEntityException('This value was not found on the statement, so it cannot be confirmed: enter it instead')
    }
    if (field.resolution === 'confirmed') return extraction
    // The database stamps the time and the confirming user; the value sent only marks the field confirmed.
    await this.updateField(db, companyId, extraction.id, name, { corrected_value: null, confirmed_at: new Date().toISOString() })
    return this.statements.getExtraction(db, companyId, statementId)
  }

  /**
   * Sets the statement's tenant, unit and lease together. The unit must be on the statement's property and the
   * lease must be that tenant's lease of that unit; without a lease, the one in force on the statement date is
   * used. The extractor's proposed match is never applied by itself: only this call sets a match. Every problem is
   * listed in one 422.
   */
  async setMatch(db: DbClient, companyId: EntityId, statementId: EntityId, body: SetStatementMatchBody): Promise<Statement> {
    const statement = await this.statementRow(db, companyId, statementId)
    assertUnderReview(statement)

    const [tenant, unit] = await Promise.all([
      db.from('tenants').select('id').eq('company_id', companyId).eq('id', body.tenantId).maybeSingle(),
      db.from('units').select('id, property_id').eq('company_id', companyId).eq('id', body.unitId).maybeSingle(),
    ])
    if (tenant.error) throw httpErrorFromDatabase(tenant.error, 'Load statement tenant')
    if (unit.error) throw httpErrorFromDatabase(unit.error, 'Load statement unit')
    const problems: string[] = []
    if (!tenant.data) problems.push('tenantId does not name a tenant in the active company')
    if (!unit.data) problems.push('unitId does not name a unit in the active company')
    else if (unit.data.property_id !== statement.property_id) problems.push("The unit is not on the statement's property")
    if (problems.length > 0) throw new UnprocessableEntityException(problems)

    const date = statementDateForMatching(
      statement.statement_date !== null ? { statementDate: statement.statement_date } : {},
      await this.extractedFields(db, companyId, statementId),
    )
    const leaseId = body.leaseId
      ? await this.checkedLease(db, companyId, statement, { ...body, leaseId: body.leaseId }, date)
      : await this.leaseInForce(db, companyId, statement, body, date)

    const { data, error } = await db
      .from('statements')
      .update({ tenant_id: body.tenantId, unit_id: body.unitId, lease_id: leaseId })
      .eq('company_id', companyId)
      .eq('id', statementId)
      .eq('status', 'review_required')
      .select('id')
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Set statement match', REVIEW_CLOSED)
    if (!data) throw new ConflictException('The statement changed while it was being matched; reload it and try again')
    return this.statements.get(db, companyId, statementId)
  }

  /** The lease the reviewer chose: the tenant's lease of the unit on the statement's property, in force on the statement date when known. */
  private async checkedLease(
    db: DbClient,
    companyId: EntityId,
    statement: ReviewedStatementRow,
    body: Required<SetStatementMatchBody>,
    date: string | undefined,
  ): Promise<EntityId> {
    const { data: row, error } = await db.from('leases').select(LEASE_COLUMNS).eq('company_id', companyId).eq('id', body.leaseId).maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Load statement lease')
    if (!row) throw new UnprocessableEntityException(['leaseId does not name a lease in the active company'])
    const problems: string[] = []
    if (row.tenant_id !== body.tenantId) problems.push('The lease belongs to a different tenant than tenantId')
    if (row.unit_id !== body.unitId) problems.push('The lease is for a different unit than unitId')
    if (row.property_id !== statement.property_id) problems.push("The lease is not on the statement's property")
    if (problems.length === 0 && date !== undefined) {
      const choice = leaseInForceOn([toLeaseCandidate(row)], date)
      if (choice.kind !== 'found') problems.push(`The lease ${row.reference} was not in force on the statement date`)
    }
    if (problems.length > 0) throw new UnprocessableEntityException(problems)
    return row.id
  }

  /** The tenant's lease of the unit that was in force on the statement date (422 when none, several, or the date is unknown). */
  private async leaseInForce(
    db: DbClient,
    companyId: EntityId,
    statement: ReviewedStatementRow,
    body: SetStatementMatchBody,
    date: string | undefined,
  ): Promise<EntityId> {
    const rows = unwrapDatabase(
      await db
        .from('leases')
        .select(LEASE_COLUMNS)
        .eq('company_id', companyId)
        .eq('tenant_id', body.tenantId)
        .eq('unit_id', body.unitId)
        .eq('property_id', statement.property_id),
      'List statement leases',
    )
    const choice = leaseInForceOn(rows.map(toLeaseCandidate), date)
    const problem = leaseChoiceProblem(choice)
    if (problem !== null || choice.kind !== 'found') throw new UnprocessableEntityException([problem ?? 'No lease was found'])
    return choice.lease.id
  }

  /** The statement under review and its pending extraction's field; 404 when either is missing, 409 when the review is closed. */
  private async reviewableField(
    db: DbClient,
    companyId: EntityId,
    statementId: EntityId,
    name: ExtractionFieldName,
  ): Promise<{ extraction: StatementExtraction; field: ExtractedField }> {
    assertUnderReview(await this.statementRow(db, companyId, statementId))
    const extraction = await this.statements.getExtraction(db, companyId, statementId)
    if (extraction.status !== 'pending_review') {
      throw new ConflictException(`The extraction is already ${extraction.status}; its values cannot change`)
    }
    const field = extraction.fields.find((candidate) => candidate.name === name)
    if (!field) throw new NotFoundException(`The extraction has no ${name} field`)
    return { extraction, field }
  }

  private async updateField(
    db: DbClient,
    companyId: EntityId,
    extractionId: EntityId,
    name: ExtractionFieldName,
    patch: Pick<TablesUpdate<'statement_extraction_fields'>, 'corrected_value' | 'confirmed_at'>,
  ): Promise<void> {
    const { data, error } = await db
      .from('statement_extraction_fields')
      .update(patch)
      .eq('company_id', companyId)
      .eq('extraction_id', extractionId)
      .eq('name', name)
      .select('id')
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Review extracted field', REVIEW_CLOSED)
    if (!data) throw new ConflictException('The statement changed while it was being reviewed; reload it and try again')
  }

  /** The latest extraction's fields, or none when processing produced no extraction. */
  private async extractedFields(db: DbClient, companyId: EntityId, statementId: EntityId): Promise<readonly ExtractedField[]> {
    try {
      return (await this.statements.getExtraction(db, companyId, statementId)).fields
    } catch (error) {
      if (error instanceof NotFoundException) return []
      throw error
    }
  }

  private async statementRow(db: DbClient, companyId: EntityId, statementId: EntityId): Promise<ReviewedStatementRow> {
    return unwrapDatabase(
      await db
        .from('statements')
        .select('id, status, property_id, statement_date, storage_path')
        .eq('company_id', companyId)
        .eq('id', statementId)
        .maybeSingle(),
      'Get statement',
    )
  }
}

/** Only a statement that needs review can be corrected or matched; uploaded and processing ones are still being read. */
function assertUnderReview(statement: Pick<ReviewedStatementRow, 'status'>): void {
  if (statement.status !== 'review_required') {
    throw new ConflictException(`The statement is ${statement.status.replace('_', ' ')}; only a statement under review can be changed`)
  }
}
