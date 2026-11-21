import { act, renderHook } from '@testing-library/react'
import type { PaymentArrangementListItem } from '@leaseguard/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createQueryWrapper, createTestQueryClient } from '@/test/queryClient'

import {
  arrangementKeys,
  useCancelArrangement,
  useCloseArrangement,
  useCreateArrangement,
  useRecordInstallmentOutcome,
  useUpdateArrangement,
} from './queries'
import type { ArrangementSource } from './source'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<ArrangementSource['list']>(),
  get: vi.fn<ArrangementSource['get']>(),
  create: vi.fn<ArrangementSource['create']>(),
  update: vi.fn<ArrangementSource['update']>(),
  close: vi.fn<ArrangementSource['close']>(),
  cancel: vi.fn<ArrangementSource['cancel']>(),
  recordInstallmentOutcome: vi.fn<ArrangementSource['recordInstallmentOutcome']>(),
}))
vi.mock('./selectSource', () => ({ getArrangementSource: () => fakeSource }))

const arrangement: PaymentArrangementListItem = {
  ...sampleRecord('paymentArrangements'),
  id: 'a1b2c3d4-0000-5000-8000-000000000003',
  companyId: NEXUS_ID,
  tenantName: 'Dlamini Cellular',
  propertyName: 'Meadowlands Square',
  unitNumber: 'S03',
  leaseReference: 'MSQ-L003',
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  for (const fn of [fakeSource.create, fakeSource.update, fakeSource.close, fakeSource.cancel, fakeSource.recordInstallmentOutcome]) {
    fn.mockReset().mockResolvedValue(arrangement)
  }
})

describe('arrangement write hooks', () => {
  it('write in the active workspace, cache the returned arrangement and refresh the lists and the arrears summary', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = createQueryWrapper(queryClient)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const create = renderHook(() => useCreateArrangement(), { wrapper })
    const body = {
      tenantId: arrangement.tenantId,
      propertyId: arrangement.propertyId,
      outstandingBalance: 10_000,
      installmentAmount: 2_500,
      frequency: 'monthly' as const,
      firstInstallmentDate: '2026-12-01',
    }
    await act(() => create.result.current.mutateAsync(body))
    expect(fakeSource.create).toHaveBeenCalledWith(NEXUS_ID, body)
    expect(queryClient.getQueryData(arrangementKeys.detail(NEXUS_ID, arrangement.id))).toEqual(arrangement)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: arrangementKeys.all })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['statements', NEXUS_ID, 'arrears'] })
  })

  it('edit, close, cancel and record instalment outcomes through the source', async () => {
    const wrapper = createQueryWrapper(createTestQueryClient())
    const update = renderHook(() => useUpdateArrangement(), { wrapper })
    await act(() => update.result.current.mutateAsync({ id: arrangement.id, changes: { notes: 'x' } }))
    expect(fakeSource.update).toHaveBeenCalledWith(NEXUS_ID, arrangement.id, { notes: 'x' })

    const close = renderHook(() => useCloseArrangement(), { wrapper })
    await act(() => close.result.current.mutateAsync({ id: arrangement.id, closing: { outcome: 'defaulted' } }))
    expect(fakeSource.close).toHaveBeenCalledWith(NEXUS_ID, arrangement.id, { outcome: 'defaulted' })

    const cancel = renderHook(() => useCancelArrangement(), { wrapper })
    await act(() => cancel.result.current.mutateAsync({ id: arrangement.id, cancellation: { reason: 'Paid in full' } }))
    expect(fakeSource.cancel).toHaveBeenCalledWith(NEXUS_ID, arrangement.id, { reason: 'Paid in full' })

    const outcome = renderHook(() => useRecordInstallmentOutcome(), { wrapper })
    await act(() => outcome.result.current.mutateAsync({ id: arrangement.id, installmentId: 'i-1', outcome: { outcome: 'confirmed_paid' } }))
    expect(fakeSource.recordInstallmentOutcome).toHaveBeenCalledWith(NEXUS_ID, arrangement.id, 'i-1', { outcome: 'confirmed_paid' })
  })
})
