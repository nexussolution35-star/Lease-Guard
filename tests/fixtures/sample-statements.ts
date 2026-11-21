import { buildStatementPdf } from './pdf.ts'

/**
 * Generated sample statements in two source-system layouts, read by the general label reader of the
 * document-processing service (python-services/document-processing/app/parsers/statement.py). Neither prints the
 * MRI markers, so the MRI reader never takes them. Each run passes its own statement number, so every file has its
 * own SHA-256. Amounts are printed the South African way (`R 35 000.00`).
 *
 * - **Sage layout** (`sageLayoutStatement`): one label and its value per line, in two columns, totals printed. The
 *   additional charges are printed garbled (`R 1 25O.00`, a letter O), so the reader finds the label but no value: the
 *   field is flagged as missing and left empty, never guessed. The total due is printed without cents, so it is read
 *   with low confidence and flagged. Everything else is read confidently.
 * - **PropSys layout** (`propSysLayoutStatement`): `Label: value` headings and dated transaction rows (date,
 *   description, amount) with the balance brought forward as the first row and no printed totals except the amount
 *   due. The rental, additional charges and payments are summed from the rows and flagged for review; the closing
 *   balance is not printed and is flagged as missing.
 */

export interface SampleStatementFacts {
  tenantName: string
  unitNumber: string
  statementNumber: string
}

/** The Sage-layout sample's figures as printed (the additional charges are garbled on the document). */
export const SAGE_SAMPLE = {
  statementDate: '2026-10-31',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  openingBalance: 0,
  rentalCharged: 35_000,
  /** What the reviewer reads off the original where the reader found no value. */
  additionalCharges: 1_250,
  paymentsReceived: 0,
  outstandingBalance: 36_250,
  totalDue: 36_250,
} as const

export function sageLayoutStatement(facts: SampleStatementFacts): Uint8Array<ArrayBuffer> {
  return buildStatementPdf([
    'TENANT STATEMENT',
    'Sage Business Cloud Accounting',
    ['Tenant name', facts.tenantName],
    ['Unit number', facts.unitNumber],
    ['Statement number', facts.statementNumber],
    ['Statement date', '31 Oct 2026'],
    ['Statement period', '01 Oct 2026 - 31 Oct 2026'],
    ['Opening balance', 'R 0.00'],
    ['Rental charged', 'R 35 000.00'],
    ['Additional charges', 'R 1 25O.00'],
    ['Payments received', 'R 0.00'],
    ['Closing balance', 'R 36 250.00'],
    ['Total amount due', 'R 36 250'],
    'Monitoring record only - not a payment request',
  ])
}

/** The PropSys-layout sample's amount due (opening R 30 000.00 + charges R 20 500.00 - payment R 2 000.00). */
export const PROPSYS_SAMPLE = {
  statementDate: '2026-10-31',
  openingBalance: 30_000,
  rentalCharged: 18_000,
  additionalCharges: 2_500,
  paymentsReceived: 2_000,
  totalDue: 48_500,
} as const

export function propSysLayoutStatement(facts: SampleStatementFacts): Uint8Array<ArrayBuffer> {
  return buildStatementPdf([
    'PROPSYS PROPERTY ACCOUNTING - STATEMENT OF ACCOUNT',
    `Account name: ${facts.tenantName}`,
    `Unit no: ${facts.unitNumber}`,
    `Statement no: ${facts.statementNumber}`,
    'Date issued: 31 Oct 2026',
    'Billing period: 01 Oct 2026 to 31 Oct 2026',
    ['01 Oct 2026', 'Balance brought forward', 'R 30 000.00'],
    ['01 Oct 2026', 'Basic rental October', 'R 18 000.00'],
    ['01 Oct 2026', 'Electricity recovery', 'R 2 500.00'],
    ['15 Oct 2026', 'Payment received - thank you', '-R 2 000.00'],
    'Amount due: R 48 500.00',
    'Monitoring record only - not a payment request',
  ])
}
