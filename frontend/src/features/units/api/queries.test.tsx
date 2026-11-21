import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createQueryWrapper, createTestQueryClient } from '@/test/queryClient'

import { unitKeys, useCreateUnit, useUnitList, useUnitQuery, useUpdateUnit } from './queries'
import type { UnitSource } from './source'

const fakeSource = vi.hoisted(() => ({
  list: vi.fn<UnitSource['list']>(),
  get: vi.fn<UnitSource['get']>(),
  create: vi.fn<UnitSource['create']>(),
  update: vi.fn<UnitSource['update']>(),
}))
vi.mock('./selectSource', () => ({ getUnitSource: () => fakeSource }))

const unit = {
  ...sampleRecord('units'),
  id: 'a1b2c3d4-0000-5000-8000-000000000002',
  companyId: NEXUS_ID,
  property: { id: 'a1b2c3d4-0000-5000-8000-0000000000aa', name: 'Meadowlands Square', code: 'MSQ' },
}

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.list.mockReset().mockResolvedValue({ items: [unit], total: 1, page: 1, pageSize: 5 })
  fakeSource.get.mockReset().mockResolvedValue(unit)
  fakeSource.create.mockReset().mockResolvedValue(unit)
  fakeSource.update.mockReset().mockResolvedValue({ ...unit, occupancyStatus: 'vacant' })
})

describe('unit query hooks', () => {
  it('read units of the active workspace through the unit source', async () => {
    const wrapper = createQueryWrapper(createTestQueryClient())
    const detail = renderHook(() => useUnitQuery(unit.id), { wrapper })
    await waitFor(() => expect(detail.result.current.data?.id).toBe(unit.id))
    expect(fakeSource.get).toHaveBeenCalledWith(NEXUS_ID, unit.id)

    const params = { page: 1, pageSize: 5, propertyId: unit.propertyId }
    const list = renderHook(() => useUnitList(params), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
    expect(fakeSource.list).toHaveBeenCalledWith(NEXUS_ID, params)
  })

  it('create and edit in the active workspace, cache the returned unit and refresh unit lists', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = createQueryWrapper(queryClient)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const create = renderHook(() => useCreateUnit(), { wrapper })
    const body = { propertyId: unit.propertyId, unitNumber: 'G14', type: 'kiosk' as const, floorAreaSqm: 12.5 }
    await act(() => create.result.current.mutateAsync(body))
    expect(fakeSource.create).toHaveBeenCalledWith(NEXUS_ID, body)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: unitKeys.all })

    const update = renderHook(() => useUpdateUnit(), { wrapper })
    await act(() => update.result.current.mutateAsync({ id: unit.id, changes: { occupancyStatus: 'vacant' } }))
    expect(fakeSource.update).toHaveBeenCalledWith(NEXUS_ID, unit.id, { occupancyStatus: 'vacant' })
    expect(queryClient.getQueryData<{ occupancyStatus: string }>(unitKeys.detail(NEXUS_ID, unit.id))?.occupancyStatus).toBe('vacant')
  })
})
