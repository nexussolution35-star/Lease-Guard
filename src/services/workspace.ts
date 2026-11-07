import { useCallback, useMemo } from 'react'

import { useAppStore } from '@/store/appStore'
import type { Company, EntityId, UserRole } from '@/types'

import { useActiveCompany, useCompanies } from '@/services/companies'
import { getActiveCompanyId, getCurrentUserId, recordAudit } from '@/services/repository'
import { membershipFor, useCurrentUser } from '@/services/users'

/**
 * Switch the active workspace. The store picks another active member user when the current
 * user has no membership in the target company. Returns `true` when the workspace changed.
 */
export function switchWorkspace(companyId: EntityId): boolean {
  const before = getActiveCompanyId()
  if (before === companyId) return false
  useAppStore.getState().switchWorkspace(companyId)
  const after = getActiveCompanyId()
  if (after === before) return false
  const company = useAppStore.getState().collections.companies[after]
  recordAudit({
    action: 'workspace_switch',
    entityType: 'company',
    entityId: after,
    summary: `Switched workspace to ${company?.name ?? after}`,
  })
  return true
}

/** Restore the demo seed (discarding local changes) and record that it happened. */
export function resetDemoData(): void {
  useAppStore.getState().resetDemoData()
  recordAudit({
    action: 'reset_demo_data',
    entityType: 'company',
    entityId: getActiveCompanyId(),
    summary: 'Demo data reset to the initial seed',
    actorUserId: getCurrentUserId(),
  })
}

export interface WorkspaceOption {
  company: Company
  /** Whether the current user has a membership in this company. */
  isMember: boolean
  /** The current user's role in this company, when a member. */
  role?: UserRole
  isActive: boolean
}

export interface WorkspaceSwitcherState {
  activeCompany: Company | undefined
  /** Member companies first (by name), then companies the current user is not a member of. */
  companies: WorkspaceOption[]
  /** Switch workspace; returns `true` when the active company changed. */
  switchTo: (companyId: EntityId) => boolean
}

export function useWorkspaceSwitcher(): WorkspaceSwitcherState {
  const activeCompany = useActiveCompany()
  const companies = useCompanies()
  const user = useCurrentUser()

  const options = useMemo<WorkspaceOption[]>(() => {
    return companies
      .map((company) => {
        const membership = user ? membershipFor(user, company.id) : undefined
        return {
          company,
          isMember: membership !== undefined,
          isActive: company.id === activeCompany?.id,
          ...(membership ? { role: membership.role } : {}),
        }
      })
      .sort((a, b) => Number(b.isMember) - Number(a.isMember) || a.company.name.localeCompare(b.company.name))
  }, [companies, user, activeCompany?.id])

  const switchTo = useCallback((companyId: EntityId) => switchWorkspace(companyId), [])

  return { activeCompany, companies: options, switchTo }
}

/** Act as another demo user (simulated sign-in; no authentication in the MVP). */
export function switchDemoUser(userId: EntityId): void {
  useAppStore.getState().setCurrentUser(userId)
}
