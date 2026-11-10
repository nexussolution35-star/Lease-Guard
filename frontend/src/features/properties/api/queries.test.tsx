import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '@/store/appStore'
import { NEXUS_ID, openWorkspace, resetWorkspace, SECOND_ID } from '@/test/accountFixtures'
import { sampleRecord } from '@/test/fakeApi'
import { createQueryWrapper, createTestQueryClient } from '@/test/queryClient'

import { usePropertyList, usePropertyQuery } from './queries'
import type { PropertyListParams, PropertySource } from './source'

const fakeSource = vi.hoisted(() => ({ list: vi.fn<PropertySource['list']>(), get: vi.fn<PropertySource['get']>() }))
vi.mock('./selectSource', () => ({ getPropertySource: () => fakeSource }))

const PARAMS: PropertyListParams = { page: 1, pageSize: 25, sort: 'name', direction: 'asc' }
const property = { ...sampleRecord('properties'), id: 'a1b2c3d4-0000-5000-8000-000000000001', companyId: NEXUS_ID }

beforeEach(() => {
  resetWorkspace()
  fakeSource.list.mockReset().mockResolvedValue({ items: [property], total: 1, page: 1, pageSize: 25 })
  fakeSource.get.mockReset().mockImplementation(async (companyId) => (companyId === NEXUS_ID ? property : null))
})

describe('property query hooks', () => {
  it('wait for a workspace before requesting anything', () => {
    const wrapper = createQueryWrapper(createTestQueryClient())
    const { result } = renderHook(() => usePropertyList(PARAMS), { wrapper })
    expect(result.current.isPending).toBe(true)
    expect(fakeSource.list).not.toHaveBeenCalled()
  })

  it('list the active workspace with the given parameters', async () => {
    openWorkspace(NEXUS_ID)
    const wrapper = createQueryWrapper(createTestQueryClient())
    const { result } = renderHook(() => usePropertyList(PARAMS), { wrapper })
    await waitFor(() => expect(result.current.data?.items).toEqual([property]))
    expect(fakeSource.list).toHaveBeenCalledWith(NEXUS_ID, PARAMS)
  })

  it('load a record for the active workspace and reload it after a workspace switch', async () => {
    openWorkspace(NEXUS_ID)
    const wrapper = createQueryWrapper(createTestQueryClient())
    const { result } = renderHook(() => usePropertyQuery(property.id), { wrapper })
    await waitFor(() => expect(result.current.data?.name).toBe(property.name))

    act(() => useAppStore.getState().setActiveCompany(SECOND_ID))
    await waitFor(() => expect(result.current.data).toBeNull())
    expect(fakeSource.get).toHaveBeenLastCalledWith(SECOND_ID, property.id)
  })
})
