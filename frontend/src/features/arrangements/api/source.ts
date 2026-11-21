import type {
  ArrangementSortField,
  CancelArrangementDto,
  CloseArrangementDto,
  CreateArrangementDto,
  InstallmentOutcomeDto,
  UpdateArrangementDto,
} from '@leaseguard/api-client'
import type { ArrangementStatus, EntityId, PaymentArrangementListItem } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { ArrangementSortField }

/** Sort fields accepted by `GET /api/v1/arrangements` (generated from the backend's OpenAPI document). */
export const ARRANGEMENT_SORT_FIELDS = ['agreedOn', 'firstInstallmentDate', 'createdAt'] as const satisfies readonly ArrangementSortField[]

/** Filters accepted by `GET /api/v1/arrangements`, each a single optional value. */
export interface ArrangementListParams extends ListParams<ArrangementSortField> {
  status?: ArrangementStatus
  leaseId?: EntityId
  tenantId?: EntityId
  propertyId?: EntityId
}

/** Body of `POST /api/v1/arrangements`: the agreement as recorded; no payment is collected. */
export type NewArrangement = CreateArrangementDto
/** Body of `PATCH /api/v1/arrangements/{arrangementId}`: omitted fields are unchanged. */
export type ArrangementChanges = UpdateArrangementDto
export type ArrangementClosing = CloseArrangementDto
export type ArrangementCancellation = CancelArrangementDto
/** What the property manager confirms happened to an instalment; `scheduled` clears it. */
export type InstallmentOutcomeRecord = InstallmentOutcomeDto

/**
 * Where payment arrangements (monitoring records, never payments) come from. Same contract as
 * `PropertySource`: the company is explicit, lists resolve to API-shaped pages and `get` resolves to
 * null when the record is not in that company.
 */
export interface ArrangementSource {
  list(companyId: EntityId, params: ArrangementListParams): Promise<Page<PaymentArrangementListItem>>
  get(companyId: EntityId, id: EntityId): Promise<PaymentArrangementListItem | null>
  create(companyId: EntityId, arrangement: NewArrangement): Promise<PaymentArrangementListItem>
  update(companyId: EntityId, id: EntityId, changes: ArrangementChanges): Promise<PaymentArrangementListItem>
  close(companyId: EntityId, id: EntityId, closing: ArrangementClosing): Promise<PaymentArrangementListItem>
  cancel(companyId: EntityId, id: EntityId, cancellation: ArrangementCancellation): Promise<PaymentArrangementListItem>
  recordInstallmentOutcome(
    companyId: EntityId,
    id: EntityId,
    installmentId: EntityId,
    outcome: InstallmentOutcomeRecord,
  ): Promise<PaymentArrangementListItem>
}
