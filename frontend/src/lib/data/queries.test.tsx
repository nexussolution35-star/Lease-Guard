import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '@/store/appStore'
import { NEXUS_ID, openWorkspace, resetWorkspace, SECOND_ID } from '@/test/accountFixtures'
import { createQueryWrapper, createTestQueryClient } from '@/test/queryClient'

import { useCompanyQuery } from './queries'

type Rows = { companyId: string; page: number; rows: string[] }

/** Resolves the first company's pages at once; every other company's request never settles. */
const fetchRows = vi.fn<(companyId: string, page: number) => Promise<Rows>>()

function useRows(page: number) {
  return useCompanyQuery(
    (companyId) => ['rows', companyId, 'list', { page }],
    (companyId) => fetchRows(companyId, page),
    { keepPrevious: true },
  )
}

function renderRows() {
  return renderHook(({ page }: { page: number }) => useRows(page), {
    initialProps: { page: 1 },
    wrapper: createQueryWrapper(createTestQueryClient()),
  })
}

beforeEach(() => {
  localStorage.clear()
  resetWorkspace()
  openWorkspace(NEXUS_ID)
  fetchRows.mockReset()
  fetchRows.mockImplementation((companyId, page) =>
    companyId === NEXUS_ID
      ? Promise.resolve({ companyId, page, rows: [`${companyId} row on page ${page}`] })
      : new Promise<Rows>(() => undefined),
  )
})

describe('useCompanyQuery keepPrevious', () => {
  it('keeps the previous page visible while the next page of the same company loads', async () => {
    const { result, rerender } = renderRows()
    await waitFor(() => expect(result.current.data?.page).toBe(1))

    fetchRows.mockImplementation(() => new Promise<Rows>(() => undefined))
    rerender({ page: 2 })

    expect(result.current.isPlaceholderData).toBe(true)
    expect(result.current.data).toEqual({ companyId: NEXUS_ID, page: 1, rows: [`${NEXUS_ID} row on page 1`] })
  })

  it('shows loading, not the previous company’s rows, after a workspace switch', async () => {
    const { result } = renderRows()
    await waitFor(() => expect(result.current.data?.companyId).toBe(NEXUS_ID))

    act(() => useAppStore.getState().setActiveCompany(SECOND_ID))

    await waitFor(() => expect(fetchRows).toHaveBeenLastCalledWith(SECOND_ID, 1))
    expect(result.current.isPending).toBe(true)
    expect(result.current.isPlaceholderData).toBe(false)
    expect(result.current.data).toBeUndefined()
  })
})
