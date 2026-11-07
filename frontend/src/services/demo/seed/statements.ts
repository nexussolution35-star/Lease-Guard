import type {
  EntityId,
  ExtractedField,
  ISODate,
  ISODateTime,
  LineItemCategory,
  LineItemKind,
  Statement,
  StatementExtraction,
  StatementSource,
  StatementStatus,
  StoredFile,
  ZAR,
} from '@leaseguard/domain'
import {
  COMMUNICATION_IDS,
  COMPANY_IDS,
  EXTRACTION_IDS,
  LEASE_IDS,
  PROPERTY_IDS,
  STATEMENT_IDS,
  TENANT_IDS,
  UNIT_IDS,
  USER_IDS,
} from './ids'
import { fakeSha256, r2, ts } from './common'

// ------------------------------------------------------------------------------------ builders

interface LineSpec {
  date: ISODate
  description: string
  category: LineItemCategory
  kind: LineItemKind
  amount: ZAR
  flagged?: boolean
}

interface StatementSpec {
  id: EntityId
  companyId: EntityId
  propertyId: EntityId
  tenantId?: EntityId
  unitId?: EntityId
  leaseId?: EntityId
  fileName: string
  /** Defaults to the file name; the duplicate statement reuses its original's label. */
  shaLabel?: string
  sizeBytes: number
  sourceSystem: StatementSource
  statementNumber?: string
  statementDate: ISODate
  periodStart: ISODate
  periodEnd: ISODate
  status: StatementStatus
  uploadBatchId?: string
  uploadedByUserId: EntityId
  uploadedAt: ISODateTime
  extractionId?: EntityId
  openingBalance?: ZAR
  lines?: readonly LineSpec[]
  verifiedByUserId?: EntityId
  verifiedAt?: ISODateTime
  deliveredCommunicationId?: EntityId
  duplicateOfStatementId?: EntityId
}

function file(spec: StatementSpec): StoredFile {
  return {
    fileName: spec.fileName,
    storagePath: `statements/${spec.fileName}`,
    mimeType: 'application/pdf',
    sizeBytes: spec.sizeBytes,
    sha256: fakeSha256(spec.shaLabel ?? spec.fileName),
  }
}

function sum(lines: readonly LineSpec[], predicate: (line: LineSpec) => boolean): ZAR {
  return r2(lines.filter(predicate).reduce((acc, line) => acc + line.amount, 0))
}

/**
 * Assemble a statement from its line items. Verified statements get their reconciled totals
 * (closing = opening + charges − payments − credits); all other statuses leave the figures undefined
 * because LeaseGuard never guesses at unconfirmed numbers.
 */
function buildStatement(spec: StatementSpec): Statement {
  const lines = spec.lines ?? []
  const lineItems = lines.map((line, index) => ({
    id: `${spec.id}_li${String(index + 1).padStart(2, '0')}`,
    statementId: spec.id,
    date: line.date,
    description: line.description,
    category: line.category,
    kind: line.kind,
    amount: line.amount,
    flagged: line.flagged ?? false,
  }))

  const base: Statement = {
    id: spec.id,
    companyId: spec.companyId,
    createdAt: spec.uploadedAt,
    updatedAt: spec.verifiedAt ?? spec.uploadedAt,
    propertyId: spec.propertyId,
    tenantId: spec.tenantId,
    unitId: spec.unitId,
    leaseId: spec.leaseId,
    file: file(spec),
    sourceSystem: spec.sourceSystem,
    statementNumber: spec.statementNumber,
    statementDate: spec.statementDate,
    periodStart: spec.periodStart,
    periodEnd: spec.periodEnd,
    status: spec.status,
    uploadBatchId: spec.uploadBatchId,
    uploadedByUserId: spec.uploadedByUserId,
    uploadedAt: spec.uploadedAt,
    extractionId: spec.extractionId,
    lineItems,
    verifiedByUserId: spec.verifiedByUserId,
    verifiedAt: spec.verifiedAt,
    deliveredCommunicationId: spec.deliveredCommunicationId,
    duplicateOfStatementId: spec.duplicateOfStatementId,
  }

  if (spec.status !== 'verified') return base

  const openingBalance = spec.openingBalance ?? 0
  const rentalCharged = sum(lines, (l) => l.kind === 'charge' && l.category === 'rental')
  const additionalCharges = sum(lines, (l) => l.kind === 'charge' && l.category !== 'rental')
  const paymentsReceived = sum(lines, (l) => l.kind === 'payment')
  const credits = sum(lines, (l) => l.kind === 'credit')
  const closingBalance = r2(openingBalance + rentalCharged + additionalCharges - paymentsReceived - credits)

  return {
    ...base,
    openingBalance,
    rentalCharged,
    additionalCharges,
    paymentsReceived,
    closingBalance,
    totalDue: closingBalance,
  }
}

interface ConfirmedExtractionSpec {
  id: EntityId
  statement: Statement
  tenantName: string
  unitNumber: string
  reviewedByUserId: EntityId
  reviewedAt: ISODateTime
}

function money(value: ZAR): string {
  return `R${value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** A high-confidence extraction whose fields mirror the verified statement figures. */
function confirmedExtraction(spec: ConfirmedExtractionSpec): StatementExtraction {
  const s = spec.statement
  const fields: ExtractedField[] = [
    { name: 'tenant_name', rawText: spec.tenantName, value: spec.tenantName, confidence: 0.98, flagged: false },
    { name: 'unit_number', rawText: spec.unitNumber, value: spec.unitNumber, confidence: 0.97, flagged: false },
    { name: 'statement_date', rawText: s.statementDate, value: s.statementDate, confidence: 0.99, flagged: false },
    { name: 'period_start', rawText: s.periodStart, value: s.periodStart, confidence: 0.98, flagged: false },
    { name: 'period_end', rawText: s.periodEnd, value: s.periodEnd, confidence: 0.98, flagged: false },
    { name: 'rental_charged', rawText: money(s.rentalCharged ?? 0), value: s.rentalCharged ?? 0, confidence: 0.96, flagged: false },
    { name: 'additional_charges', rawText: money(s.additionalCharges ?? 0), value: s.additionalCharges ?? 0, confidence: 0.95, flagged: false },
    { name: 'payments_received', rawText: money(s.paymentsReceived ?? 0), value: s.paymentsReceived ?? 0, confidence: 0.96, flagged: false },
    { name: 'outstanding_balance', rawText: money(s.openingBalance ?? 0), value: s.openingBalance ?? 0, confidence: 0.94, flagged: false },
    { name: 'total_due', rawText: money(s.totalDue ?? 0), value: s.totalDue ?? 0, confidence: 0.97, flagged: false },
  ]
  const extractedAt = s.uploadedAt
  return {
    id: spec.id,
    companyId: s.companyId,
    createdAt: extractedAt,
    updatedAt: spec.reviewedAt,
    statementId: s.id,
    engine: 'leaseguard-ocr/2.3',
    extractedAt,
    overallConfidence: 0.97,
    fields,
    matchedTenantId: s.tenantId,
    matchedUnitId: s.unitId,
    matchConfidence: 0.98,
    status: 'confirmed',
    reviewedByUserId: spec.reviewedByUserId,
    reviewedAt: spec.reviewedAt,
  }
}

// ------------------------------------------------------------------------------------ Nexus

const nexus = COMPANY_IDS.nexus
const OCT = { statementDate: '2026-10-01', periodStart: '2026-10-01', periodEnd: '2026-10-31' } as const
const SEP = { statementDate: '2026-09-01', periodStart: '2026-09-01', periodEnd: '2026-09-30' } as const
const NOV = { statementDate: '2026-11-01', periodStart: '2026-11-01', periodEnd: '2026-11-30' } as const

const msqThrifty202610 = buildStatement({
  id: STATEMENT_IDS.msqThrifty202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.msq,
  tenantId: TENANT_IDS.thriftyFoods,
  unitId: UNIT_IDS.msqA01,
  leaseId: LEASE_IDS.msqL001,
  fileName: 'MSQ-2026-10-A01-ThriftyFoods.pdf',
  sizeBytes: 188_420,
  sourceSystem: 'MRI',
  statementNumber: 'MRI-MSQ-202610-0001',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_msq_2026_10',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-10-02T08:15'),
  extractionId: EXTRACTION_IDS.msqThrifty202610,
  openingBalance: 0,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 226632.96 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 48500 },
    { date: '2026-10-01', description: 'Rates and taxes recovery', category: 'rates_and_taxes', kind: 'charge', amount: 21300 },
    { date: '2026-10-01', description: 'Marketing levy', category: 'marketing_levy', kind: 'charge', amount: 4200 },
    { date: '2026-10-01', description: 'Electricity and water – September consumption', category: 'utilities', kind: 'charge', amount: 18940.55 },
    { date: '2026-10-05', description: 'EFT payment received – THRIFTY FOODS MDL', category: 'payment', kind: 'payment', amount: 319573.51 },
  ],
  verifiedByUserId: USER_IDS.siphoPm,
  verifiedAt: ts('2026-10-02T09:40'),
  deliveredCommunicationId: COMMUNICATION_IDS.stmtThrifty,
})

/** Rental charged at the pre-June-2026 amount (R34,560) instead of the escalated R37,324.80. */
const msqPharmaCare202610 = buildStatement({
  id: STATEMENT_IDS.msqPharmaCare202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.msq,
  tenantId: TENANT_IDS.pharmaCare,
  unitId: UNIT_IDS.msqS02,
  leaseId: LEASE_IDS.msqL002,
  fileName: 'MSQ-2026-10-S02-PharmaCare.pdf',
  sizeBytes: 142_110,
  sourceSystem: 'MRI',
  statementNumber: 'MRI-MSQ-202610-0002',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_msq_2026_10',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-10-02T08:15'),
  extractionId: EXTRACTION_IDS.msqPharmaCare202610,
  openingBalance: 0,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 34560 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 6200 },
    { date: '2026-10-01', description: 'Electricity – September consumption', category: 'utilities', kind: 'charge', amount: 3180.4 },
    { date: '2026-10-03', description: 'EFT payment received – PHARMACARE MDL', category: 'payment', kind: 'payment', amount: 43940.4 },
  ],
  verifiedByUserId: USER_IDS.siphoPm,
  verifiedAt: ts('2026-10-02T09:52'),
  deliveredCommunicationId: COMMUNICATION_IDS.stmtPharmaCare,
})

const msqDlamini202609 = buildStatement({
  id: STATEMENT_IDS.msqDlamini202609,
  companyId: nexus,
  propertyId: PROPERTY_IDS.msq,
  tenantId: TENANT_IDS.dlaminiCellular,
  unitId: UNIT_IDS.msqS03,
  leaseId: LEASE_IDS.msqL003,
  fileName: 'MSQ-2026-09-S03-DlaminiCellular.pdf',
  sizeBytes: 131_874,
  sourceSystem: 'MRI',
  statementNumber: 'MRI-MSQ-202609-0003',
  ...SEP,
  status: 'verified',
  uploadBatchId: 'batch_msq_2026_09',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-09-02T08:20'),
  extractionId: EXTRACTION_IDS.msqDlamini202609,
  openingBalance: 24800,
  lines: [
    { date: '2026-09-01', description: 'Basic rental – September 2026', category: 'rental', kind: 'charge', amount: 16601.05 },
    { date: '2026-09-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 2400 },
    { date: '2026-09-01', description: 'Interest on overdue balance', category: 'interest', kind: 'charge', amount: 248 },
    { date: '2026-09-15', description: 'Cash deposit – arrangement instalment 2 of 5', category: 'payment', kind: 'payment', amount: 6200 },
    { date: '2026-09-28', description: 'EFT payment received – M DLAMINI', category: 'payment', kind: 'payment', amount: 19001.05 },
  ],
  verifiedByUserId: USER_IDS.siphoPm,
  verifiedAt: ts('2026-09-02T10:05'),
})

const msqDlamini202610 = buildStatement({
  id: STATEMENT_IDS.msqDlamini202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.msq,
  tenantId: TENANT_IDS.dlaminiCellular,
  unitId: UNIT_IDS.msqS03,
  leaseId: LEASE_IDS.msqL003,
  fileName: 'MSQ-2026-10-S03-DlaminiCellular.pdf',
  sizeBytes: 129_955,
  sourceSystem: 'MRI',
  statementNumber: 'MRI-MSQ-202610-0003',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_msq_2026_10',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-10-02T08:15'),
  extractionId: EXTRACTION_IDS.msqDlamini202610,
  openingBalance: 18848,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 16601.05 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 2400 },
    { date: '2026-10-01', description: 'Interest on overdue balance', category: 'interest', kind: 'charge', amount: 188.48 },
    { date: '2026-10-29', description: 'EFT payment received – M DLAMINI', category: 'payment', kind: 'payment', amount: 19001.05 },
  ],
  verifiedByUserId: USER_IDS.siphoPm,
  verifiedAt: ts('2026-10-02T10:10'),
})

const msqKasi202611 = buildStatement({
  id: STATEMENT_IDS.msqKasi202611,
  companyId: nexus,
  propertyId: PROPERTY_IDS.msq,
  tenantId: TENANT_IDS.kasiFlame,
  unitId: UNIT_IDS.msqR04,
  leaseId: LEASE_IDS.msqL004,
  fileName: 'MSQ-2026-11-R04-KasiFlameGrill.pdf',
  sizeBytes: 140_212,
  sourceSystem: 'MRI',
  statementNumber: 'MRI-MSQ-202611-0004',
  ...NOV,
  status: 'processing',
  uploadBatchId: 'batch_msq_2026_11',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-11-05T16:40'),
})

const dvcFreshMart202610 = buildStatement({
  id: STATEMENT_IDS.dvcFreshMart202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.dvc,
  tenantId: TENANT_IDS.freshMart,
  unitId: UNIT_IDS.dvc01,
  leaseId: LEASE_IDS.dvcL001,
  fileName: 'DVC-2026-10-Shop1-FreshMart.pdf',
  sizeBytes: 165_300,
  sourceSystem: 'Sage',
  statementNumber: 'SG-DVC-10-2026-001',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_dvc_2026_10',
  uploadedByUserId: USER_IDS.nalediPm,
  uploadedAt: ts('2026-10-03T07:50'),
  extractionId: EXTRACTION_IDS.dvcFreshMart202610,
  openingBalance: 0,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 90811.9 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 14200 },
    { date: '2026-10-01', description: 'Rates recovery', category: 'rates_and_taxes', kind: 'charge', amount: 6850 },
    { date: '2026-10-01', description: 'Electricity and water – September', category: 'utilities', kind: 'charge', amount: 9120.3 },
    { date: '2026-10-02', description: 'EFT payment received – FRESHMART DBV', category: 'payment', kind: 'payment', amount: 120982.2 },
  ],
  verifiedByUserId: USER_IDS.nalediPm,
  verifiedAt: ts('2026-10-03T09:10'),
})

/** Same PDF uploaded again a month later; detected by matching sha256. */
const dvcFreshMart202610Dup = buildStatement({
  id: STATEMENT_IDS.dvcFreshMart202610Dup,
  companyId: nexus,
  propertyId: PROPERTY_IDS.dvc,
  tenantId: TENANT_IDS.freshMart,
  unitId: UNIT_IDS.dvc01,
  leaseId: LEASE_IDS.dvcL001,
  fileName: 'DVC-2026-10-Shop1-FreshMart (1).pdf',
  shaLabel: 'DVC-2026-10-Shop1-FreshMart.pdf',
  sizeBytes: 165_300,
  sourceSystem: 'Sage',
  statementNumber: 'SG-DVC-10-2026-001',
  ...OCT,
  status: 'duplicate',
  uploadBatchId: 'batch_dvc_2026_11',
  uploadedByUserId: USER_IDS.nalediPm,
  uploadedAt: ts('2026-11-04T08:05'),
  duplicateOfStatementId: STATEMENT_IDS.dvcFreshMart202610,
})

const dvcKoffiehuis202610 = buildStatement({
  id: STATEMENT_IDS.dvcKoffiehuis202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.dvc,
  tenantId: TENANT_IDS.koffiehuis,
  unitId: UNIT_IDS.dvc04,
  leaseId: LEASE_IDS.dvcL004,
  fileName: 'DVC-2026-10-Shop4-DieKoffiehuis.pdf',
  sizeBytes: 133_720,
  sourceSystem: 'Sage',
  statementNumber: 'SG-DVC-10-2026-004',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_dvc_2026_10',
  uploadedByUserId: USER_IDS.nalediPm,
  uploadedAt: ts('2026-10-03T07:50'),
  extractionId: EXTRACTION_IDS.dvcKoffiehuis202610,
  openingBalance: 48000,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 20865 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 3100 },
    { date: '2026-10-01', description: 'Interest on overdue balance', category: 'interest', kind: 'charge', amount: 480 },
    { date: '2026-10-01', description: 'EFT payment received – arrangement instalment 1 of 4', category: 'payment', kind: 'payment', amount: 12000 },
    { date: '2026-10-05', description: 'EFT payment received – DIE KOFFIEHUIS', category: 'payment', kind: 'payment', amount: 23965 },
  ],
  verifiedByUserId: USER_IDS.nalediPm,
  verifiedAt: ts('2026-10-03T09:25'),
})

/** OCR could not read the tenant name or rental cleanly; held for review. */
const dvcBosman202610 = buildStatement({
  id: STATEMENT_IDS.dvcBosman202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.dvc,
  tenantId: TENANT_IDS.bosmanTheron,
  unitId: UNIT_IDS.dvc02,
  leaseId: LEASE_IDS.dvcL002,
  fileName: 'DVC-2026-10-Shop2-scan.pdf',
  sizeBytes: 2_410_880,
  sourceSystem: 'Sage',
  ...OCT,
  status: 'review_required',
  uploadBatchId: 'batch_dvc_2026_10',
  uploadedByUserId: USER_IDS.nalediPm,
  uploadedAt: ts('2026-10-03T07:50'),
  extractionId: EXTRACTION_IDS.dvcBosman202610,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 24300, flagged: true },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 2650 },
    { date: '2026-10-06', description: 'EFT payment received – BOSMAN THERON', category: 'payment', kind: 'payment', amount: 26950 },
  ],
})

const kstMolefe202610 = buildStatement({
  id: STATEMENT_IDS.kstMolefe202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.kst,
  tenantId: TENANT_IDS.molefeMahlangu,
  unitId: UNIT_IDS.kstG01,
  leaseId: LEASE_IDS.kstL001,
  fileName: 'KST-2026-10-G01-MolefeMahlangu.pdf',
  sizeBytes: 171_002,
  sourceSystem: 'MDA',
  statementNumber: 'MDA/KST/2026-10/G01',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_kst_2026_10',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-10-02T11:00'),
  extractionId: EXTRACTION_IDS.kstMolefe202610,
  openingBalance: 0,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 106118.14 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 21400 },
    { date: '2026-10-01', description: 'Parking – 24 basement bays', category: 'parking', kind: 'charge', amount: 7200 },
    { date: '2026-10-01', description: 'EFT payment received – MOLEFE MAHLANGU INC', category: 'payment', kind: 'payment', amount: 134718.14 },
  ],
  verifiedByUserId: USER_IDS.siphoPm,
  verifiedAt: ts('2026-10-02T11:45'),
  deliveredCommunicationId: COMMUNICATION_IDS.stmtMolefe,
})

const kstNkosi202610 = buildStatement({
  id: STATEMENT_IDS.kstNkosi202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.kst,
  tenantId: TENANT_IDS.nkosiNdlovu,
  unitId: UNIT_IDS.kst301,
  leaseId: LEASE_IDS.kstL002,
  fileName: 'KST-2026-10-301-NkosiNdlovu.pdf',
  sizeBytes: 168_441,
  sourceSystem: 'MDA',
  statementNumber: 'MDA/KST/2026-10/301',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_kst_2026_10',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-10-02T11:00'),
  extractionId: EXTRACTION_IDS.kstNkosi202610,
  openingBalance: 0,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 150720.12 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 32500 },
    { date: '2026-10-01', description: 'Parking – 32 basement bays', category: 'parking', kind: 'charge', amount: 9600 },
    { date: '2026-10-01', description: 'EFT payment received – NKOSI NDLOVU INC', category: 'payment', kind: 'payment', amount: 192820.12 },
  ],
  verifiedByUserId: USER_IDS.siphoPm,
  verifiedAt: ts('2026-10-02T11:50'),
})

const kstHorizon202611 = buildStatement({
  id: STATEMENT_IDS.kstHorizon202611,
  companyId: nexus,
  propertyId: PROPERTY_IDS.kst,
  tenantId: TENANT_IDS.horizonFintech,
  unitId: UNIT_IDS.kst302,
  leaseId: LEASE_IDS.kstL007,
  fileName: 'KST-2026-11-302-HorizonFintech.pdf',
  sizeBytes: 159_870,
  sourceSystem: 'MDA',
  statementNumber: 'MDA/KST/2026-11/302',
  ...NOV,
  status: 'verified',
  uploadBatchId: 'batch_kst_2026_11',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-11-03T08:30'),
  extractionId: EXTRACTION_IDS.kstHorizon202611,
  openingBalance: 0,
  lines: [
    { date: '2026-11-01', description: 'Basic rental – November 2026 (escalated 1 Nov 2026)', category: 'rental', kind: 'charge', amount: 56160 },
    { date: '2026-11-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 15500 },
    { date: '2026-11-01', description: 'Parking – 12 basement bays', category: 'parking', kind: 'charge', amount: 3600 },
    { date: '2026-11-02', description: 'EFT payment received – HORIZON FINTECH', category: 'payment', kind: 'payment', amount: 75260 },
  ],
  verifiedByUserId: USER_IDS.siphoPm,
  verifiedAt: ts('2026-11-03T09:05'),
})

const wipTransKaroo202610 = buildStatement({
  id: STATEMENT_IDS.wipTransKaroo202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.wip,
  tenantId: TENANT_IDS.transKaroo,
  unitId: UNIT_IDS.wipW1,
  leaseId: LEASE_IDS.wipL001,
  fileName: 'WIP-2026-10-W1-TransKaroo.pdf',
  sizeBytes: 176_230,
  sourceSystem: 'MRI',
  statementNumber: 'MRI-WIP-202610-0001',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_wip_2026_10',
  uploadedByUserId: USER_IDS.nalediPm,
  uploadedAt: ts('2026-10-02T13:10'),
  extractionId: EXTRACTION_IDS.wipTransKaroo202610,
  openingBalance: 0,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026 (Warehouse 1)', category: 'rental', kind: 'charge', amount: 190065.42 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 28500 },
    { date: '2026-10-01', description: 'Rates and taxes recovery', category: 'rates_and_taxes', kind: 'charge', amount: 12300 },
    { date: '2026-10-01', description: 'EFT payment received – TRANSKAROO LOGISTICS', category: 'payment', kind: 'payment', amount: 230865.42 },
  ],
  verifiedByUserId: USER_IDS.nalediPm,
  verifiedAt: ts('2026-10-02T14:00'),
})

const wipPallet202609 = buildStatement({
  id: STATEMENT_IDS.wipPallet202609,
  companyId: nexus,
  propertyId: PROPERTY_IDS.wip,
  tenantId: TENANT_IDS.gautengPallet,
  unitId: UNIT_IDS.wipW4,
  leaseId: LEASE_IDS.wipL005,
  fileName: 'WIP-2026-09-W4-GautengPallet.pdf',
  sizeBytes: 149_880,
  sourceSystem: 'MRI',
  statementNumber: 'MRI-WIP-202609-0004',
  ...SEP,
  status: 'verified',
  uploadBatchId: 'batch_wip_2026_09',
  uploadedByUserId: USER_IDS.nalediPm,
  uploadedAt: ts('2026-09-02T13:00'),
  extractionId: EXTRACTION_IDS.wipPallet202609,
  openingBalance: 42000,
  lines: [
    { date: '2026-09-01', description: 'Basic rental – September 2026', category: 'rental', kind: 'charge', amount: 94500 },
    { date: '2026-09-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 11200 },
    { date: '2026-09-01', description: 'Interest on overdue balance', category: 'interest', kind: 'charge', amount: 420 },
    { date: '2026-09-20', description: 'EFT payment received – GAUTENG PALLET', category: 'payment', kind: 'payment', amount: 50000 },
  ],
  verifiedByUserId: USER_IDS.nalediPm,
  verifiedAt: ts('2026-09-02T14:10'),
})

const wipPallet202610 = buildStatement({
  id: STATEMENT_IDS.wipPallet202610,
  companyId: nexus,
  propertyId: PROPERTY_IDS.wip,
  tenantId: TENANT_IDS.gautengPallet,
  unitId: UNIT_IDS.wipW4,
  leaseId: LEASE_IDS.wipL005,
  fileName: 'WIP-2026-10-W4-GautengPallet.pdf',
  sizeBytes: 151_004,
  sourceSystem: 'MRI',
  statementNumber: 'MRI-WIP-202610-0004',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_wip_2026_10',
  uploadedByUserId: USER_IDS.nalediPm,
  uploadedAt: ts('2026-10-02T13:10'),
  extractionId: EXTRACTION_IDS.wipPallet202610,
  openingBalance: 98120,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 94500 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 11200 },
    { date: '2026-10-01', description: 'Interest on overdue balance', category: 'interest', kind: 'charge', amount: 981.2 },
    { date: '2026-10-25', description: 'EFT payment received – GAUTENG PALLET', category: 'payment', kind: 'payment', amount: 40000 },
  ],
  verifiedByUserId: USER_IDS.nalediPm,
  verifiedAt: ts('2026-10-02T14:20'),
})

// ------------------------------------------------------------------------------------ Kgalagadi

const kgl = COMPANY_IDS.kgalagadi

const hcrJacaranda202610 = buildStatement({
  id: STATEMENT_IDS.hcrJacaranda202610,
  companyId: kgl,
  propertyId: PROPERTY_IDS.hcr,
  tenantId: TENANT_IDS.jacarandaPharmacy,
  unitId: UNIT_IDS.hcr01,
  leaseId: LEASE_IDS.hcrL001,
  fileName: 'HCR-2026-10-Shop1-JacarandaPharmacy.pdf',
  sizeBytes: 128_440,
  sourceSystem: 'Sage',
  statementNumber: 'SG-HCR-10-2026-001',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_hcr_2026_10',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-10-04T09:00'),
  extractionId: EXTRACTION_IDS.hcrJacaranda202610,
  openingBalance: 0,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 34347 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 4800 },
    { date: '2026-10-02', description: 'EFT payment received – JACARANDA PHARMACY', category: 'payment', kind: 'payment', amount: 39147 },
  ],
  verifiedByUserId: USER_IDS.siphoPm,
  verifiedAt: ts('2026-10-04T09:30'),
})

const hcrTuks202610 = buildStatement({
  id: STATEMENT_IDS.hcrTuks202610,
  companyId: kgl,
  propertyId: PROPERTY_IDS.hcr,
  tenantId: TENANT_IDS.tuksCopy,
  unitId: UNIT_IDS.hcr03,
  leaseId: LEASE_IDS.hcrL003,
  fileName: 'HCR-2026-10-Shop3-TuksCopyPrint.pdf',
  sizeBytes: 121_770,
  sourceSystem: 'Sage',
  statementNumber: 'SG-HCR-10-2026-003',
  ...OCT,
  status: 'verified',
  uploadBatchId: 'batch_hcr_2026_10',
  uploadedByUserId: USER_IDS.siphoPm,
  uploadedAt: ts('2026-10-04T09:00'),
  extractionId: EXTRACTION_IDS.hcrTuks202610,
  openingBalance: 21000,
  lines: [
    { date: '2026-10-01', description: 'Basic rental – October 2026', category: 'rental', kind: 'charge', amount: 14292.19 },
    { date: '2026-10-01', description: 'Operating cost recovery', category: 'operating_costs', kind: 'charge', amount: 1900 },
    { date: '2026-10-01', description: 'Interest on overdue balance', category: 'interest', kind: 'charge', amount: 210 },
    { date: '2026-10-15', description: 'EFT payment received – arrangement instalment 2 of 7', category: 'payment', kind: 'payment', amount: 3500 },
    { date: '2026-10-28', description: 'EFT payment received – TUKS COPY', category: 'payment', kind: 'payment', amount: 16192.19 },
  ],
  verifiedByUserId: USER_IDS.siphoPm,
  verifiedAt: ts('2026-10-04T09:40'),
})

export const statements: readonly Statement[] = [
  msqThrifty202610,
  msqPharmaCare202610,
  msqDlamini202609,
  msqDlamini202610,
  msqKasi202611,
  dvcFreshMart202610,
  dvcFreshMart202610Dup,
  dvcKoffiehuis202610,
  dvcBosman202610,
  kstMolefe202610,
  kstNkosi202610,
  kstHorizon202611,
  wipTransKaroo202610,
  wipPallet202609,
  wipPallet202610,
  hcrJacaranda202610,
  hcrTuks202610,
]

// ------------------------------------------------------------------------------------ extractions

const bosmanExtraction: StatementExtraction = {
  id: EXTRACTION_IDS.dvcBosman202610,
  companyId: nexus,
  createdAt: ts('2026-10-03T07:52'),
  updatedAt: ts('2026-10-03T07:52'),
  statementId: STATEMENT_IDS.dvcBosman202610,
  engine: 'leaseguard-ocr/2.3',
  extractedAt: ts('2026-10-03T07:52'),
  overallConfidence: 0.71,
  fields: [
    { name: 'tenant_name', rawText: 'Bosman & Theron Attomeys lnc', value: 'Bosman & Theron Attomeys lnc', confidence: 0.62, flagged: true },
    { name: 'unit_number', rawText: 'Shop 2', value: 'Shop 2', confidence: 0.91, flagged: false },
    { name: 'statement_date', rawText: '01/10/2026', value: '2026-10-01', confidence: 0.95, flagged: false },
    { name: 'period_start', rawText: '01/10/2026', value: '2026-10-01', confidence: 0.94, flagged: false },
    { name: 'period_end', rawText: '31/10/2026', value: '2026-10-31', confidence: 0.94, flagged: false },
    { name: 'rental_charged', rawText: 'R24,3O0.00', value: null, confidence: 0.55, flagged: true },
    { name: 'additional_charges', rawText: 'R2,650.00', value: 2650, confidence: 0.9, flagged: false },
    { name: 'payments_received', rawText: 'R26,950.00', value: 26950, confidence: 0.92, flagged: false },
    { name: 'outstanding_balance', rawText: 'R0.00', value: 0, confidence: 0.88, flagged: false },
    { name: 'total_due', rawText: 'R0.0O', value: null, confidence: 0.58, flagged: true },
  ],
  matchedTenantId: TENANT_IDS.bosmanTheron,
  matchedUnitId: UNIT_IDS.dvc02,
  matchConfidence: 0.68,
  status: 'pending_review',
  reviewNotes: 'Scanned copy; tenant name and rental figures need manual confirmation.',
}

export const statementExtractions: readonly StatementExtraction[] = [
  confirmedExtraction({ id: EXTRACTION_IDS.msqThrifty202610, statement: msqThrifty202610, tenantName: 'Thrifty Foods Meadowlands (Pty) Ltd', unitNumber: 'A01', reviewedByUserId: USER_IDS.siphoPm, reviewedAt: ts('2026-10-02T09:40') }),
  confirmedExtraction({ id: EXTRACTION_IDS.msqPharmaCare202610, statement: msqPharmaCare202610, tenantName: 'PharmaCare Meadowlands (Pty) Ltd', unitNumber: 'S02', reviewedByUserId: USER_IDS.siphoPm, reviewedAt: ts('2026-10-02T09:52') }),
  confirmedExtraction({ id: EXTRACTION_IDS.msqDlamini202609, statement: msqDlamini202609, tenantName: 'Dlamini Cellular & Repairs', unitNumber: 'S03', reviewedByUserId: USER_IDS.siphoPm, reviewedAt: ts('2026-09-02T10:05') }),
  confirmedExtraction({ id: EXTRACTION_IDS.msqDlamini202610, statement: msqDlamini202610, tenantName: 'Dlamini Cellular & Repairs', unitNumber: 'S03', reviewedByUserId: USER_IDS.siphoPm, reviewedAt: ts('2026-10-02T10:10') }),
  confirmedExtraction({ id: EXTRACTION_IDS.dvcFreshMart202610, statement: dvcFreshMart202610, tenantName: 'FreshMart Durbanville (Pty) Ltd', unitNumber: 'Shop 1', reviewedByUserId: USER_IDS.nalediPm, reviewedAt: ts('2026-10-03T09:10') }),
  confirmedExtraction({ id: EXTRACTION_IDS.dvcKoffiehuis202610, statement: dvcKoffiehuis202610, tenantName: 'Die Koffiehuis Durbanville (Pty) Ltd', unitNumber: 'Shop 4', reviewedByUserId: USER_IDS.nalediPm, reviewedAt: ts('2026-10-03T09:25') }),
  bosmanExtraction,
  confirmedExtraction({ id: EXTRACTION_IDS.kstMolefe202610, statement: kstMolefe202610, tenantName: 'Molefe Mahlangu Chartered Accountants Inc', unitNumber: 'G01', reviewedByUserId: USER_IDS.siphoPm, reviewedAt: ts('2026-10-02T11:45') }),
  confirmedExtraction({ id: EXTRACTION_IDS.kstNkosi202610, statement: kstNkosi202610, tenantName: 'Nkosi Ndlovu Attorneys Inc', unitNumber: '301', reviewedByUserId: USER_IDS.siphoPm, reviewedAt: ts('2026-10-02T11:50') }),
  confirmedExtraction({ id: EXTRACTION_IDS.kstHorizon202611, statement: kstHorizon202611, tenantName: 'Horizon Fintech Solutions (Pty) Ltd', unitNumber: '302', reviewedByUserId: USER_IDS.siphoPm, reviewedAt: ts('2026-11-03T09:05') }),
  confirmedExtraction({ id: EXTRACTION_IDS.wipTransKaroo202610, statement: wipTransKaroo202610, tenantName: 'TransKaroo Logistics (Pty) Ltd', unitNumber: 'Warehouse 1', reviewedByUserId: USER_IDS.nalediPm, reviewedAt: ts('2026-10-02T14:00') }),
  confirmedExtraction({ id: EXTRACTION_IDS.wipPallet202609, statement: wipPallet202609, tenantName: 'Gauteng Pallet Supplies CC', unitNumber: 'Warehouse 4', reviewedByUserId: USER_IDS.nalediPm, reviewedAt: ts('2026-09-02T14:10') }),
  confirmedExtraction({ id: EXTRACTION_IDS.wipPallet202610, statement: wipPallet202610, tenantName: 'Gauteng Pallet Supplies CC', unitNumber: 'Warehouse 4', reviewedByUserId: USER_IDS.nalediPm, reviewedAt: ts('2026-10-02T14:20') }),
  confirmedExtraction({ id: EXTRACTION_IDS.hcrJacaranda202610, statement: hcrJacaranda202610, tenantName: 'Jacaranda Pharmacy Hatfield (Pty) Ltd', unitNumber: 'Shop 1', reviewedByUserId: USER_IDS.siphoPm, reviewedAt: ts('2026-10-04T09:30') }),
  confirmedExtraction({ id: EXTRACTION_IDS.hcrTuks202610, statement: hcrTuks202610, tenantName: 'Tuks Copy & Print CC', unitNumber: 'Shop 3', reviewedByUserId: USER_IDS.siphoPm, reviewedAt: ts('2026-10-04T09:40') }),
]
