import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEMO_COMPANY_IDS } from '@/data'
import { useAppStore } from '@/store/appStore'

import { listAllTenants } from '@/services/tenants'
import { searchWorkspace, useWorkspaceSearch } from '@/services/search'
import { switchWorkspace } from '@/services/workspace'

const NEXUS = DEMO_COMPANY_IDS.nexus
const SECOND = 'cmp_kgalagadi'

function allResultIds(term: string): string[] {
  return searchWorkspace(term, 100).flatMap((g) => g.results.map((r) => r.id))
}

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

describe('searchWorkspace', () => {
  it('ignores terms shorter than two characters', () => {
    expect(searchWorkspace('')).toEqual([])
    expect(searchWorkspace(' a ')).toEqual([])
  })

  it('returns grouped results with hrefs for the active company only', () => {
    expect(useAppStore.getState().workspace.activeCompanyId).toBe(NEXUS)
    const groups = searchWorkspace('pharmacy', 100)
    const tenants = groups.find((g) => g.entityType === 'tenant')
    expect(tenants?.label).toBe('Tenants')
    const titles = tenants?.results.map((r) => r.title) ?? []
    expect(titles).toContain('PharmaCare Pharmacy')
    expect(titles).not.toContain('Jacaranda Pharmacy')
    for (const r of tenants?.results ?? []) expect(r.href).toBe(`/tenants/${r.id}`)

    const nexusTenantIds = new Set(listAllTenants().map((t) => t.id))
    for (const r of tenants?.results ?? []) expect(nexusTenantIds.has(r.id)).toBe(true)
  })

  it('switching workspace changes the results', () => {
    expect(allResultIds('hatfield')).toEqual([])

    switchWorkspace(SECOND)
    expect(useAppStore.getState().workspace.activeCompanyId).toBe(SECOND)

    const groups = searchWorkspace('pharmacy', 100)
    const titles = groups.flatMap((g) => g.results.map((r) => r.title))
    expect(titles).toContain('Jacaranda Pharmacy')
    expect(titles).not.toContain('PharmaCare Pharmacy')
    expect(allResultIds('hatfield').length).toBeGreaterThan(0)
  })

  it('caps each group at the limit', () => {
    for (const group of searchWorkspace('un', 2)) expect(group.results.length).toBeLessThanOrEqual(2)
  })

  it('records an audit entry when switching workspace', () => {
    const count = () =>
      Object.values(useAppStore.getState().collections.auditLogs).filter(
        (l) => l.action === 'workspace_switch' && l.companyId === SECOND,
      ).length
    const before = count()
    switchWorkspace(SECOND)
    expect(count()).toBe(before + 1)
  })
})

describe('useWorkspaceSearch', () => {
  it('recomputes when the workspace changes', () => {
    const { result } = renderHook(() => useWorkspaceSearch('pharmacy', 100))
    const titles = () => result.current.flatMap((g) => g.results.map((r) => r.title))
    expect(titles()).toContain('PharmaCare Pharmacy')
    act(() => {
      switchWorkspace(SECOND)
    })
    expect(titles()).toContain('Jacaranda Pharmacy')
    expect(titles()).not.toContain('PharmaCare Pharmacy')
  })
})
