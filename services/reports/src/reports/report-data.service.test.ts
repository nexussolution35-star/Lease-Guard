import { ForbiddenException, InternalServerErrorException } from '@nestjs/common'
import type { DbClient } from '@leaseguard/service-kit'
import { describe, expect, it } from 'vitest'

import { ReportDataService } from './report-data.service'

const COMPANY = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d'

function dbAnswering(result: { data: unknown; error: { code: string; message: string } | null }) {
  const calls: { fn: string; args: unknown }[] = []
  const db = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args })
      return result
    },
  } as unknown as DbClient
  return { db, calls }
}

describe('ReportDataService', () => {
  const service = new ReportDataService()

  it('calls the reporting function for the company and maps its rows (numeric strings, nulls left out)', async () => {
    const { db, calls } = dbAnswering({
      data: [{ tenant_id: 't1', property_id: 'p1', unit_id: null, lease_id: 'l1', statement_id: 's1', statement_date: '2026-10-31', outstanding: '1500.50' }],
      error: null,
    })
    expect(await service.arrearsAccounts(db, COMPANY)).toEqual([
      { tenantId: 't1', propertyId: 'p1', leaseId: 'l1', statementId: 's1', statementDate: '2026-10-31', outstanding: 1500.5 },
    ])
    expect(calls).toEqual([{ fn: 'reports_arrears_accounts', args: { p_company_id: COMPANY } }])
  })

  it('answers 403 when the database refuses the company (42501)', async () => {
    const { db } = dbAnswering({ data: null, error: { code: '42501', message: 'Only members of the company can read its reports' } })
    await expect(service.unitOccupancy(db, COMPANY)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('fails loudly on rows of an unexpected shape rather than reporting wrong figures', async () => {
    const { db } = dbAnswering({ data: [{ property_id: 'p1', unit_count: 'many' }], error: null })
    await expect(service.propertyFigures(db, COMPANY)).rejects.toBeInstanceOf(InternalServerErrorException)
  })
})
