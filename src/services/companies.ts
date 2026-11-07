import { useMemo } from 'react'

import { useAppStore } from '@/store/appStore'
import { nowISO } from '@/store/ids'
import type { Company, CompanySettings, EntityId } from '@/types'

import { diffScalarFields, getActiveCompanyId, recordAudit } from '@/services/repository'

/** Global: every company in the store (used by the workspace switcher). */
export function listCompanies(): Company[] {
  return Object.values(useAppStore.getState().collections.companies)
}

export function getCompanyById(id: EntityId): Company | undefined {
  return useAppStore.getState().collections.companies[id]
}

export function getActiveCompany(): Company {
  const company = getCompanyById(getActiveCompanyId())
  if (!company) throw new Error('Active workspace company not found')
  return company
}

export function updateCompany(patch: Partial<Omit<Company, 'id' | 'createdAt' | 'updatedAt'>>): Company {
  const before = getActiveCompany()
  const after: Company = { ...before, ...patch, updatedAt: nowISO() }
  useAppStore.getState().upsert('companies', after)
  recordAudit({
    action: 'update',
    entityType: 'company',
    entityId: after.id,
    summary: 'Company details updated',
    changes: diffScalarFields(before, after),
  })
  return after
}

export function updateSettings(patch: Partial<CompanySettings>): Company {
  const before = getActiveCompany()
  const settings: CompanySettings = { ...before.settings, ...patch }
  const after: Company = { ...before, settings, updatedAt: nowISO() }
  useAppStore.getState().upsert('companies', after)
  recordAudit({
    action: 'update',
    entityType: 'company',
    entityId: after.id,
    summary: 'Company settings updated',
    changes: diffScalarFields(before.settings, settings),
  })
  return after
}

export function useActiveCompany(): Company | undefined {
  return useAppStore((s) => s.collections.companies[s.workspace.activeCompanyId])
}

export function useCompanies(): Company[] {
  const map = useAppStore((s) => s.collections.companies)
  return useMemo(() => Object.values(map), [map])
}
