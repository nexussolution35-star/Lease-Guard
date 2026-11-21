import type { CreateLeaseDto, LeaseSortField, UpdateLeaseDto } from '@leaseguard/api-client'
import type { EntityId, Lease, LeaseDocument, LeaseDocumentType, LeaseListItem, LeaseStatus } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

export type { LeaseSortField }

/** Sort fields accepted by `GET /api/v1/leases` (generated from the backend's OpenAPI document). */
export const LEASE_SORT_FIELDS = [
  'reference',
  'commencementDate',
  'expiryDate',
  'currentMonthlyRental',
  'createdAt',
] as const satisfies readonly LeaseSortField[]

/** Filters accepted by `GET /api/v1/leases`, each a single optional value. */
export interface LeaseListParams extends ListParams<LeaseSortField> {
  status?: LeaseStatus
  propertyId?: EntityId
  unitId?: EntityId
  tenantId?: EntityId
  /** Only leases whose terms are (or are not yet) verified. */
  verified?: boolean
  /** Only leases expiring from today to this many days from today (South African date), inclusive. */
  expiresWithinDays?: number
}

/** `POST /leases` body. A new lease is unverified; the reference is unique in the company. */
export type NewLease = CreateLeaseDto

/**
 * `PATCH /leases/{id}` body: omitted fields are unchanged; escalation, renewal option, deposit and bank guarantee each
 * replace the whole group, and null removes the deposit or guarantee. A term change unverifies a verified lease
 * (`editRequiresReverification` in `@leaseguard/domain` says so before saving).
 */
export type LeaseChanges = UpdateLeaseDto

/** One PDF to record on a lease: the file, its document type and the title it is listed under. */
export interface LeaseDocumentUpload {
  file: File
  documentType: LeaseDocumentType
  title: string
}

/**
 * Where leases come from. Same contract as `PropertySource`: the company is explicit, lists
 * resolve to API-shaped pages and `get` resolves to null when the record is not in that company.
 */
export interface LeaseSource {
  /** List items also carry the tenant, property and unit names. */
  list(companyId: EntityId, params: LeaseListParams): Promise<Page<LeaseListItem>>
  get(companyId: EntityId, id: EntityId): Promise<Lease | null>
  /**
   * Company admins and property managers. Marks the terms verified; the database records who and when.
   * Verifying an already verified lease returns it unchanged. Rejects with 403 for other roles, 404 when absent.
   */
  verify(companyId: EntityId, id: EntityId): Promise<Lease>
  /**
   * Company admins and property managers. Rejects with 409 for a reference already used, 422 when the tenant, property
   * and unit do not belong together or the property is archived.
   */
  create(companyId: EntityId, lease: NewLease): Promise<Lease>
  /** Rejects with 422 when the dates or a database rule refuse the change, 404 when absent. */
  update(companyId: EntityId, id: EntityId, changes: LeaseChanges): Promise<Lease>
  /** The documents recorded on the lease, newest first. Rejects with 404 when the lease is not in that company. */
  listDocuments(companyId: EntityId, leaseId: EntityId): Promise<LeaseDocument[]>
  /**
   * Company admins and property managers. Uploads a PDF of at most 20 MB to protected storage and records it on the lease;
   * the database records the uploader. Rejects with 413 above the limit, 422 when the stored file is not a PDF, 404 when
   * the lease is absent, and with `LeaseDocumentUploadError` when storage refused the file.
   */
  uploadDocument(companyId: EntityId, leaseId: EntityId, upload: LeaseDocumentUpload): Promise<LeaseDocument>
  /** A short-lived (five-minute) link to the document's PDF. Rejects with 404 when the document is not on that lease. */
  documentDownloadUrl(companyId: EntityId, leaseId: EntityId, documentId: EntityId): Promise<string>
}
