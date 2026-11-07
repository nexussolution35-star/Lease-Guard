import { useMemo } from 'react'

import { nowISO, todayISO } from '@/store/ids'
import type { EntityId, ISODate, Lease, LeaseDocument, LeaseEscalation, RenewalOption, StoredFile } from '@leaseguard/domain'

import type { ListQuery, PagedResult } from '@/services/query'
import { createRepository, getCurrentUserId, type CreateInput } from '@/services/repository'
import { assignTenant, releaseUnit } from '@/services/units'

export const leasesRepo = createRepository('leases', {
  entityType: 'lease',
  label: 'Lease',
  idPrefix: 'lease',
  searchFields: ['reference', 'notes'],
})

export const leaseDocumentsRepo = createRepository('leaseDocuments', {
  entityType: 'lease_document',
  label: 'Lease document',
  idPrefix: 'ldoc',
  searchFields: ['title'],
})

export const listLeases = leasesRepo.list
export const listAllLeases = leasesRepo.listAll
export const getLease = leasesRepo.getById
export const updateLease = leasesRepo.update

export type CreateLeaseInput = Omit<CreateInput<Lease>, 'verified' | 'verifiedByUserId' | 'verifiedAt'>

/** Create a lease and point its unit at it. New leases always start unverified. */
export function createLease(input: CreateLeaseInput): Lease {
  const lease = leasesRepo.create({ ...input, verified: false })
  assignTenant(lease.unitId, lease.tenantId, lease.id)
  return lease
}

/** Mark lease terms as verified so they may drive financial monitoring. */
export function verifyLease(leaseId: EntityId): Lease {
  const lease = leasesRepo.require(leaseId)
  const status: Lease['status'] =
    lease.status === 'draft' || lease.status === 'pending_verification' ? 'active' : lease.status
  return leasesRepo.update(
    leaseId,
    { verified: true, verifiedByUserId: getCurrentUserId(), verifiedAt: nowISO(), status },
    { action: 'verify', summary: `Lease ${lease.reference} verified` },
  )
}

export function terminateLease(leaseId: EntityId, notes?: string): Lease {
  const lease = leasesRepo.require(leaseId)
  const updated = leasesRepo.update(
    leaseId,
    { status: 'terminated', ...(notes !== undefined ? { notes } : {}) },
    { summary: `Lease ${lease.reference} terminated` },
  )
  releaseUnit(lease.unitId)
  return updated
}

export interface RenewLeaseInput {
  reference: string
  commencementDate: ISODate
  expiryDate: ISODate
  initialMonthlyRental: number
  paymentDueDay?: number
  escalation?: LeaseEscalation
  renewalOption?: RenewalOption
  notes?: string
}

/**
 * Renew a lease: the old lease becomes `renewed`, a new unverified lease is created with
 * `previousLeaseId` and the unit is pointed at the new lease.
 */
export function renewLease(leaseId: EntityId, input: RenewLeaseInput): Lease {
  const previous = leasesRepo.require(leaseId)
  const renewal = leasesRepo.create(
    {
      reference: input.reference,
      propertyId: previous.propertyId,
      unitId: previous.unitId,
      tenantId: previous.tenantId,
      commencementDate: input.commencementDate,
      expiryDate: input.expiryDate,
      initialMonthlyRental: input.initialMonthlyRental,
      currentMonthlyRental: input.initialMonthlyRental,
      paymentDueDay: input.paymentDueDay ?? previous.paymentDueDay,
      escalation: input.escalation ?? { ...previous.escalation, firstEscalationDate: input.commencementDate },
      renewalOption: input.renewalOption ?? { exists: false, exercised: false },
      ...(previous.deposit ? { deposit: previous.deposit } : {}),
      ...(previous.bankGuarantee ? { bankGuarantee: previous.bankGuarantee } : {}),
      status: 'pending_verification',
      verified: false,
      previousLeaseId: previous.id,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    { summary: `Lease ${input.reference} created as renewal of ${previous.reference}` },
  )
  leasesRepo.update(
    leaseId,
    {
      status: 'renewed',
      renewalOption: { ...previous.renewalOption, exercised: true, exercisedOn: todayISO() },
    },
    { summary: `Lease ${previous.reference} renewed by ${renewal.reference}` },
  )
  assignTenant(previous.unitId, previous.tenantId, renewal.id)
  return renewal
}

export interface AddLeaseDocumentInput {
  leaseId: EntityId
  documentType: LeaseDocument['documentType']
  title: string
  file: StoredFile
}

export function addLeaseDocument(input: AddLeaseDocumentInput): LeaseDocument {
  leasesRepo.require(input.leaseId)
  return leaseDocumentsRepo.create(
    { ...input, uploadedByUserId: getCurrentUserId(), uploadedAt: nowISO() },
    { action: 'upload', summary: `Document "${input.title}" uploaded` },
  )
}

export function listLeaseDocuments(leaseId: EntityId): LeaseDocument[] {
  return leaseDocumentsRepo.listAll().filter((d) => d.leaseId === leaseId)
}

export function removeLeaseDocument(documentId: EntityId): void {
  leaseDocumentsRepo.remove(documentId)
}

// Hooks --------------------------------------------------------------------

export function useLeases(query?: ListQuery<Lease>): PagedResult<Lease> {
  return leasesRepo.useList(query)
}

export const useAllLeases = leasesRepo.useAll
export const useLease = leasesRepo.useById

export function useLeasesForTenant(tenantId: EntityId | undefined): Lease[] {
  const all = leasesRepo.useAll()
  return useMemo(
    () =>
      tenantId
        ? all.filter((l) => l.tenantId === tenantId).sort((a, b) => b.commencementDate.localeCompare(a.commencementDate))
        : [],
    [all, tenantId],
  )
}

export function useLeaseDocuments(leaseId: EntityId | undefined): LeaseDocument[] {
  const all = leaseDocumentsRepo.useAll()
  return useMemo(() => (leaseId ? all.filter((d) => d.leaseId === leaseId) : []), [all, leaseId])
}
