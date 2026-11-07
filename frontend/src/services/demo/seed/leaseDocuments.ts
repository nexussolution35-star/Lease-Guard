import type { LeaseDocument, LeaseDocumentType, StoredFile } from '@leaseguard/domain'
import { COMPANY_IDS, LEASE_DOCUMENT_IDS, LEASE_IDS, USER_IDS } from './ids'
import { fakeSha256, ts } from './common'

function pdf(fileName: string, sizeBytes: number): StoredFile {
  return {
    fileName,
    storagePath: `leases/${fileName}`,
    mimeType: 'application/pdf',
    sizeBytes,
    sha256: fakeSha256(fileName),
  }
}

interface DocSpec {
  id: string
  companyId: string
  leaseId: string
  documentType: LeaseDocumentType
  title: string
  fileName: string
  sizeBytes: number
  uploadedByUserId: string
  uploadedAt: string
}

function doc(spec: DocSpec): LeaseDocument {
  return {
    id: spec.id,
    companyId: spec.companyId,
    createdAt: spec.uploadedAt,
    updatedAt: spec.uploadedAt,
    leaseId: spec.leaseId,
    documentType: spec.documentType,
    title: spec.title,
    file: pdf(spec.fileName, spec.sizeBytes),
    uploadedByUserId: spec.uploadedByUserId,
    uploadedAt: spec.uploadedAt,
  }
}

const nexus = COMPANY_IDS.nexus

export const leaseDocuments: readonly LeaseDocument[] = [
  doc({ id: LEASE_DOCUMENT_IDS.msqL001Signed, companyId: nexus, leaseId: LEASE_IDS.msqL001, documentType: 'signed_lease', title: 'Signed lease agreement – Thrifty Foods (MSQ-L001)', fileName: 'MSQ-L001-signed-lease.pdf', sizeBytes: 2_482_113, uploadedByUserId: USER_IDS.thandiAdmin, uploadedAt: ts('2025-01-25T09:05') }),
  doc({ id: LEASE_DOCUMENT_IDS.msqL001Guarantee, companyId: nexus, leaseId: LEASE_IDS.msqL001, documentType: 'bank_guarantee', title: 'Standard Bank guarantee SBG/2023/0045812', fileName: 'MSQ-L001-bank-guarantee.pdf', sizeBytes: 412_880, uploadedByUserId: USER_IDS.thandiAdmin, uploadedAt: ts('2025-01-25T09:08') }),
  doc({ id: LEASE_DOCUMENT_IDS.msqL002Signed, companyId: nexus, leaseId: LEASE_IDS.msqL002, documentType: 'signed_lease', title: 'Signed lease agreement – PharmaCare (MSQ-L002)', fileName: 'MSQ-L002-signed-lease.pdf', sizeBytes: 1_904_552, uploadedByUserId: USER_IDS.siphoPm, uploadedAt: ts('2025-01-25T09:12') }),
  doc({ id: LEASE_DOCUMENT_IDS.dvcL001Signed, companyId: nexus, leaseId: LEASE_IDS.dvcL001, documentType: 'signed_lease', title: 'Signed lease agreement – FreshMart (DVC-L001)', fileName: 'DVC-L001-signed-lease.pdf', sizeBytes: 2_210_339, uploadedByUserId: USER_IDS.nalediPm, uploadedAt: ts('2025-01-26T09:02') }),
  doc({ id: LEASE_DOCUMENT_IDS.dvcL003Signed, companyId: nexus, leaseId: LEASE_IDS.dvcL003, documentType: 'signed_lease', title: 'Signed lease agreement – Tygerberg Health Pharmacy (DVC-L003)', fileName: 'DVC-L003-signed-lease.pdf', sizeBytes: 1_788_002, uploadedByUserId: USER_IDS.nalediPm, uploadedAt: ts('2026-10-28T15:02') }),
  doc({ id: LEASE_DOCUMENT_IDS.kstL001Signed, companyId: nexus, leaseId: LEASE_IDS.kstL001, documentType: 'signed_lease', title: 'Signed lease agreement – Molefe Mahlangu CA (KST-L001)', fileName: 'KST-L001-signed-lease.pdf', sizeBytes: 2_655_410, uploadedByUserId: USER_IDS.siphoPm, uploadedAt: ts('2025-01-27T09:03') }),
  doc({ id: LEASE_DOCUMENT_IDS.kstL001Guarantee, companyId: nexus, leaseId: LEASE_IDS.kstL001, documentType: 'bank_guarantee', title: 'Standard Bank guarantee SBG/2022/0038821', fileName: 'KST-L001-bank-guarantee.pdf', sizeBytes: 398_774, uploadedByUserId: USER_IDS.siphoPm, uploadedAt: ts('2025-01-27T09:06') }),
  doc({ id: LEASE_DOCUMENT_IDS.kstL007Renewal, companyId: nexus, leaseId: LEASE_IDS.kstL007, documentType: 'renewal_agreement', title: 'Renewal agreement – Horizon Fintech (KST-L007)', fileName: 'KST-L007-renewal-agreement.pdf', sizeBytes: 1_322_908, uploadedByUserId: USER_IDS.siphoPm, uploadedAt: ts('2025-10-10T11:05') }),
  doc({ id: LEASE_DOCUMENT_IDS.wipL001Signed, companyId: nexus, leaseId: LEASE_IDS.wipL001, documentType: 'signed_lease', title: 'Signed lease agreement – TransKaroo Logistics (WIP-L001)', fileName: 'WIP-L001-signed-lease.pdf', sizeBytes: 3_018_227, uploadedByUserId: USER_IDS.nalediPm, uploadedAt: ts('2025-01-28T09:03') }),
  doc({ id: LEASE_DOCUMENT_IDS.wipL003Signed, companyId: nexus, leaseId: LEASE_IDS.wipL003, documentType: 'signed_lease', title: 'Signed lease agreement – Eastrand Steel Fabricators (WIP-L003)', fileName: 'WIP-L003-signed-lease.pdf', sizeBytes: 2_144_651, uploadedByUserId: USER_IDS.nalediPm, uploadedAt: ts('2026-11-03T10:32') }),
  doc({ id: LEASE_DOCUMENT_IDS.hcrL001Signed, companyId: COMPANY_IDS.kgalagadi, leaseId: LEASE_IDS.hcrL001, documentType: 'signed_lease', title: 'Signed lease agreement – Jacaranda Pharmacy (HCR-L001)', fileName: 'HCR-L001-signed-lease.pdf', sizeBytes: 1_975_310, uploadedByUserId: USER_IDS.siphoPm, uploadedAt: ts('2026-08-24T09:02') }),
]
