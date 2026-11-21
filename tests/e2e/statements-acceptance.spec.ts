import { createHash } from 'node:crypto'

import { expect, test, type Locator, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { propSysLayoutStatement, sageLayoutStatement, SAGE_SAMPLE } from '../fixtures/sample-statements.ts'
import { createAcceptancePortfolio, ESCALATION_EXAMPLE, removeAcceptancePortfolio, type AcceptancePortfolio } from '../fixtures/statement-acceptance.ts'
import { serviceRoleClient } from '../fixtures/world.ts'
import { signIn } from './support/app.ts'
import { e2eContext, e2eUser, e2eWorld } from './support/world.ts'

/**
 * Statements acceptance (ticket S-09): PRD §13.3 and the statement side of §13.4 in the browser, on the real stack
 * (the API, the statement worker and the document-processing service that run-api.ts starts). A property manager
 * uploads two generated statements in two source-system layouts (Sage and PropSys) and copies of one of them; the
 * copy in the same upload and the same file in a later upload are identified as duplicates and not processed again.
 * The originals are kept and shown; the values are read from the documents and the uncertain ones are flagged; the
 * manager enters the value the reader could not read and the one it read without enough certainty (audited
 * corrections), sets the tenant, unit and lease from the proposal and verifies. The figures are saved with the sign-off, and monitoring for
 * the tenant raises the arrears and the escalation discrepancy (the PRD's R35 000 at 8% example: R2 800 short), both
 * naming that statement. The other statement stays unverified and raises no arrears.
 *
 * Runs in its own Playwright project after every other spec (playwright.config.ts): it adds two units, tenants and
 * leases to the world's property "Disa Industrial Park" (service role), removed with everything raised from them in
 * afterAll.
 */

const PROPERTY_CODE = 'DIP'
let portfolio: AcceptancePortfolio
let db: SupabaseClient

const sha256 = (bytes: Uint8Array | Buffer) => createHash('sha256').update(bytes).digest('hex')

test.beforeAll(async () => {
  db = serviceRoleClient(e2eContext().supabase)
  const company = e2eWorld().companies.a
  const property = company.properties.find((candidate) => candidate.code === PROPERTY_CODE)
  if (!property) throw new Error(`The e2e world has no property ${PROPERTY_CODE}`)
  portfolio = await createAcceptancePortfolio(db, { companyId: company.id, propertyId: property.id, verifierUserId: e2eUser('manager').id, runId: `${e2eWorld().runId}e2e` })
})

test.afterAll(async () => {
  if (portfolio) await removeAcceptancePortfolio(db, portfolio)
})

/** Chooses an option of a labelled select (Radix Select: a combobox and a listbox of options). */
async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

function fileRow(page: Page, fileName: string): Locator {
  // By the row's own file name: another row's outcome may name this file too ("The same file as …").
  return page.getByRole('list', { name: 'Chosen files' }).getByRole('listitem').filter({ has: page.getByText(fileName, { exact: true }) })
}

/** The statement a file row links to, from its link's href (`/statements/<id>`). */
async function linkedStatementId(row: Locator, linkName: string): Promise<string> {
  const href = await row.getByRole('link', { name: linkName }).getAttribute('href')
  const id = href?.match(/\/statements\/([0-9a-f-]{36})$/)?.[1]
  if (!id) throw new Error(`No statement link "${linkName}" in the row (href ${href})`)
  return id
}

const pdf = (name: string, bytes: Uint8Array) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) })

interface EventRow {
  type: string
  status: string
  statement_id: string | null
  tenant_id: string | null
  lease_id: string | null
  calculation: { expectedAmount?: number; actualAmount?: number; difference?: number } | null
}

async function events(column: 'statement_id' | 'tenant_id', value: string): Promise<EventRow[]> {
  const { data, error } = await db
    .from('monitoring_events')
    .select('type, status, statement_id, tenant_id, lease_id, calculation')
    .eq('company_id', portfolio.companyId)
    .eq(column, value)
  if (error) throw new Error(`Read monitoring events: ${error.message}`)
  return data as EventRow[]
}

const MONEY_EVENTS = new Set(['arrears', 'rental_escalation_discrepancy'])
const moneyEvents = (rows: readonly EventRow[]) => rows.filter((row) => MONEY_EVENTS.has(row.type))

test.describe('Statements acceptance', () => {
  test('upload in two layouts, flagged values, a correction, duplicates, verification and the monitoring it raises', async ({ page }) => {
    test.setTimeout(240_000)
    const { marker, escalating, other } = portfolio
    const sage = sageLayoutStatement({ tenantName: escalating.tradingName, unitNumber: escalating.unitNumber, statementNumber: `SG-${marker}-10` })
    const propSys = propSysLayoutStatement({ tenantName: other.tradingName, unitNumber: other.unitNumber, statementNumber: `PS-${marker}-10` })
    const files = {
      sage: `${marker}-sage-oct-2026.pdf`,
      sageCopy: `${marker}-sage-oct-2026-copy.pdf`,
      sageAgain: `${marker}-sage-oct-2026-again.pdf`,
      propSys: `${marker}-propsys-oct-2026.pdf`,
    }
    const manager = e2eUser('manager')
    let sageId = ''
    let propSysId = ''

    await signIn(page, manager, '/statements/upload')

    await test.step('upload the Sage statement with a copy of it: the copy is caught in the same upload', async () => {
      await choose(page, 'Property', 'Disa Industrial Park')
      // The property's accounting system (MRI) is preselected; these statements came from Sage.
      await expect(page.getByRole('combobox', { name: 'Source system' })).toHaveText('MRI')
      await choose(page, 'Source system', 'Sage')
      await page.locator('input[type="file"]').setInputFiles([pdf(files.sage, sage), pdf(files.sageCopy, sage)])
      await page.getByRole('button', { name: 'Upload 2 statements' }).click()

      await expect(fileRow(page, files.sage)).toContainText('Queued for processing')
      await expect(fileRow(page, files.sageCopy)).toContainText('Repeated in this upload')
      await expect(page.getByText('1 registered · 1 duplicate · 0 failed')).toBeVisible()
      sageId = await linkedStatementId(fileRow(page, files.sage), 'Open the statement')
      expect(await linkedStatementId(fileRow(page, files.sageCopy), 'Open the statement')).toBe(sageId)
    })

    await test.step('upload the PropSys statement and the Sage file again: the file on record is not processed twice', async () => {
      await page.getByRole('button', { name: 'Upload more statements' }).click()
      await choose(page, 'Source system', 'PropSys')
      await page.locator('input[type="file"]').setInputFiles([pdf(files.propSys, propSys), pdf(files.sageAgain, sage)])
      await page.getByRole('button', { name: 'Upload 2 statements' }).click()

      await expect(fileRow(page, files.propSys)).toContainText('Queued for processing')
      await expect(fileRow(page, files.sageAgain)).toContainText('Already uploaded')
      expect(await linkedStatementId(fileRow(page, files.sageAgain), 'Open the statement on record')).toBe(sageId)
      propSysId = await linkedStatementId(fileRow(page, files.propSys), 'Open the statement')

      const { data, error } = await db.from('statements').select('id, file_name, source_system').eq('company_id', portfolio.companyId).ilike('file_name', `${marker}%`)
      if (error) throw new Error(error.message)
      // One statement per distinct file: the copies were never registered.
      expect(new Map((data as { id: string; file_name: string; source_system: string }[]).map((row) => [row.file_name, [row.id, row.source_system]]))).toEqual(
        new Map([
          [files.sage, [sageId, 'Sage']],
          [files.propSys, [propSysId, 'PropSys']],
        ]),
      )
    })

    await test.step('both statements are read by the worker and wait for review, raising no arrears', async () => {
      await expect
        .poll(
          async () => {
            const { data } = await db.from('statements').select('id, status').in('id', [sageId, propSysId])
            return (data as { id: string; status: string }[] | null)?.map((row) => row.status).sort()
          },
          { timeout: 90_000, intervals: [1_000] },
        )
        .toEqual(['review_required', 'review_required'])
      expect(moneyEvents(await events('statement_id', sageId))).toEqual([])
      expect(moneyEvents(await events('statement_id', propSysId))).toEqual([])
      expect((await events('statement_id', sageId)).map((row) => [row.type, row.status])).toEqual([['statement_review_required', 'new']])
    })

    await test.step('the review screen keeps the original and shows what was read, flagging what is uncertain', async () => {
      await page.goto(`/statements/${sageId}`)
      // Named after its file until verified (the statement number is a figure of the verified statement).
      await expect(page.getByRole('heading', { level: 1, name: files.sage })).toBeVisible()
      const original = page.locator(`iframe[title="Original statement: ${files.sage}"]`)
      await expect(original).toBeVisible()
      // The original is the uploaded file, byte for byte, through its short-lived link.
      const src = await original.getAttribute('src')
      expect(src).toBeTruthy()
      const download = await page.request.get(src!)
      expect(download.ok()).toBe(true)
      expect(sha256(await download.body())).toBe(sha256(sage))

      const field = (label: string) => page.getByRole('listitem', { name: label, exact: true })
      await expect(field('Tenant name')).toContainText(escalating.tradingName)
      await expect(field('Unit number')).toContainText(escalating.unitNumber)
      await expect(field('Statement number')).toContainText(`SG-${marker}-10`)
      await expect(field('Statement date')).toContainText('31 Oct 2026')
      await expect(field('Period start')).toContainText('01 Oct 2026')
      await expect(field('Period end')).toContainText('31 Oct 2026')
      await expect(field('Rental charged')).toContainText(/R\s?35\s000,00/)
      await expect(field('Outstanding balance')).toContainText(/R\s?36\s250,00/)
      await expect(field('Rental charged')).toContainText('Found, not flagged')
      // Not read: flagged as missing and left empty, never guessed.
      await expect(field('Additional charges')).toContainText('Not found')
      await expect(field('Additional charges')).toContainText('Missing')
      await expect(field('Additional charges')).toContainText('Enter it')
      // Printed without cents: read with low confidence, so the amount is not used (never pre-filled) and is entered
      // from the original.
      await expect(field('Total due')).toContainText('Low confidence')
      await expect(field('Total due')).toContainText('Total amount due R 36 250')
      await expect(field('Total due')).toContainText('Enter it')
      await expect(page.getByRole('button', { name: 'Verify', exact: true })).toBeDisabled()
      await expect(page.getByRole('region', { name: 'Verification' })).toContainText('The tenant is not set')
    })

    await test.step('enter the values that were not read or not certain, and set the tenant, unit and lease', async () => {
      const field = (label: string) => page.getByRole('listitem', { name: label, exact: true })
      for (const [label, amount, shown] of [
        ['Additional charges', '1 250.00', /R\s?1\s250,00/],
        ['Total due', '36 250.00', /R\s?36\s250,00/],
      ] as const) {
        await page.getByRole('button', { name: `Enter ${label.toLowerCase()}` }).click()
        const dialog = page.getByRole('dialog', { name: `Enter the ${label.toLowerCase()}` })
        await dialog.getByLabel(`${label} (ZAR)`).fill(amount)
        await dialog.getByRole('button', { name: 'Save value' }).click()
        await expect(dialog).toBeHidden()
        await expect(field(label)).toContainText(shown)
        await expect(field(label)).toContainText('Corrected')
        await expect(field(label)).toContainText(manager.fullName)
      }

      // The proposal from extraction is the starting point; it is applied only when saved.
      const match = page.getByRole('region', { name: 'Tenant, unit and lease' })
      await expect(match).toContainText(`Proposed from the statement: ${escalating.tradingName}, unit ${escalating.unitNumber}`)
      await match.getByRole('button', { name: 'Save tenant, unit and lease' }).click()
      await expect(match).toContainText(escalating.leaseReference)
    })

    await test.step('verify: the figures are saved with the sign-off', async () => {
      await expect(page.getByRole('button', { name: 'Verify', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Verify', exact: true }).click()
      const dialog = page.getByRole('alertdialog', { name: 'Verify this statement?' }).or(page.getByRole('dialog', { name: 'Verify this statement?' }))
      await dialog.getByRole('button', { name: 'Verify' }).click()
      const verification = page.getByRole('region', { name: 'Verification' })
      await expect(page.getByRole('heading', { level: 1, name: `Statement SG-${marker}-10` })).toBeVisible()
      await expect(verification).toContainText(manager.fullName)
      await expect(verification).toContainText(/R\s?36\s250,00/)
      await expect(verification).toContainText(/R\s?1\s250,00/)

      const { data, error } = await db
        .from('statements')
        .select(
          'status, tenant_id, unit_id, lease_id, statement_number, statement_date, period_start, period_end, opening_balance, rental_charged, additional_charges, payments_received, closing_balance, total_due, verified_by_user_id, verified_at',
        )
        .eq('id', sageId)
        .single()
      if (error) throw new Error(error.message)
      expect(data).toMatchObject({
        status: 'verified',
        tenant_id: escalating.tenantId,
        unit_id: escalating.unitId,
        lease_id: escalating.leaseId,
        statement_number: `SG-${marker}-10`,
        statement_date: SAGE_SAMPLE.statementDate,
        period_start: SAGE_SAMPLE.periodStart,
        period_end: SAGE_SAMPLE.periodEnd,
        opening_balance: SAGE_SAMPLE.openingBalance,
        rental_charged: SAGE_SAMPLE.rentalCharged,
        additional_charges: SAGE_SAMPLE.additionalCharges,
        payments_received: SAGE_SAMPLE.paymentsReceived,
        closing_balance: SAGE_SAMPLE.outstandingBalance,
        total_due: SAGE_SAMPLE.totalDue,
        verified_by_user_id: manager.id,
      })

      // Each correction is audited with before and after, by the manager.
      const { data: extraction } = await db.from('statement_extractions').select('id').eq('statement_id', sageId).single()
      const { data: audit } = await db
        .from('audit_logs')
        .select('actor_user_id, summary, changes')
        .eq('entity_id', (extraction as { id: string }).id)
        .like('summary', 'Corrected extracted field %')
        .order('summary')
      expect(audit).toEqual([
        { actor_user_id: manager.id, summary: 'Corrected extracted field additional_charges', changes: [{ field: 'additional_charges', before: null, after: 1250 }] },
        { actor_user_id: manager.id, summary: 'Corrected extracted field total_due', changes: [{ field: 'total_due', before: null, after: 36250 }] },
      ])
    })

    await test.step('monitoring raises the arrears and the escalation discrepancy, each naming the statement', async () => {
      await expect
        .poll(async () => moneyEvents(await events('statement_id', sageId)).map((row) => row.type).sort(), { timeout: 60_000, intervals: [1_000] })
        .toEqual(['arrears', 'rental_escalation_discrepancy'])
      const raised = await events('statement_id', sageId)
      const arrears = raised.find((row) => row.type === 'arrears')
      expect(arrears).toMatchObject({ tenant_id: escalating.tenantId, lease_id: escalating.leaseId })
      expect(arrears?.calculation?.actualAmount).toBe(SAGE_SAMPLE.outstandingBalance)
      const escalation = raised.find((row) => row.type === 'rental_escalation_discrepancy')
      expect(escalation).toMatchObject({ tenant_id: escalating.tenantId, lease_id: escalating.leaseId })
      expect(escalation?.calculation).toMatchObject({ expectedAmount: ESCALATION_EXAMPLE.expectedRental, difference: ESCALATION_EXAMPLE.difference })
      // Verifying closed the statement's review event.
      expect(raised.find((row) => row.type === 'statement_review_required')?.status).toBe('resolved')

      // The unverified statement and its tenant raise nothing.
      expect(moneyEvents(await events('statement_id', propSysId))).toEqual([])
      expect(moneyEvents(await events('tenant_id', other.tenantId))).toEqual([])
      // No tenant was sent (or queued) anything about it: escalations never reach tenants.
      const { count } = await db.from('communications').select('id', { count: 'exact', head: true }).in('tenant_id', [escalating.tenantId, other.tenantId])
      expect(count).toBe(0)
    })

    await test.step('the Statements page counts the verified balance only, linking to its statement', async () => {
      await page.goto('/statements')
      const inArrears = page.getByRole('table', { name: 'Tenants in arrears' })
      const row = inArrears.getByRole('row').filter({ hasText: escalating.tradingName })
      await expect(row).toContainText(/R\s?36\s250,00/)
      await expect(inArrears).not.toContainText(other.tradingName)
      await row.click()
      await expect(page).toHaveURL(`/statements/${sageId}`)
    })

    await test.step('the PropSys statement was read from its own layout and still needs review', async () => {
      await page.goto(`/statements/${propSysId}`)
      const field = (label: string) => page.getByRole('listitem', { name: label, exact: true })
      await expect(field('Tenant name')).toContainText(other.tradingName)
      await expect(field('Statement number')).toContainText(`PS-${marker}-10`)
      // Figures read without enough certainty are not used: each shows what the statement printed and is entered by
      // the reviewer. The rental is summed from the rows, the closing balance is not printed at all.
      await expect(field('Opening balance')).toContainText('Balance brought forward R 30 000.00')
      await expect(field('Opening balance')).toContainText('Low confidence')
      await expect(field('Total due')).toContainText('Amount due: R 48 500.00')
      await expect(field('Rental charged')).toContainText('Enter it')
      await expect(field('Outstanding balance')).toContainText('Not found')
      await expect(field('Outstanding balance')).toContainText('Missing')
      await expect(page.getByRole('table', { name: /^Lines of / })).toContainText('Electricity recovery')
      await expect(page.getByRole('button', { name: 'Verify', exact: true })).toBeDisabled()
      await expect(page.getByRole('region', { name: 'Verification' })).toContainText('Not verified')
    })
  })
})
