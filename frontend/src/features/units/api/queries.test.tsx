import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NEXUS_ID, openWorkspace, resetWorkspace } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createQueryWrapper, createTestQueryClient } from '@/test/queryClient'

import { useUnitList, useUnitQuery } from './queries'
import type { UnitSource } from './source'

const fakeSource = vi.hoisted(() => ({ list: vi.fn<UnitSource['list']>(), get: vi.fn<UnitSource['get']>() }))
vi.mock('./selectSource', () => ({ getUnitSource: () => fakeSource }))

const unit = { ...sampleRecord('units'), id: 'a1b2c3d4-0000-5000-8000-000000000002', companyId: NEXUS_ID }

beforeEach(() => {
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fakeSource.list.mockReset().mockResolvedValue({ items: [unit], total: 1, page: 1, pageSize: 5 })
  fakeSource.get.mockReset().mockResolvedValue(unit)
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
})
