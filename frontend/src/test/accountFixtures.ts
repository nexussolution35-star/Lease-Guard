import type { CurrentUserProfile, WorkspaceMembership } from '@/features/account/api/source'
import { useAppStore } from '@/store/appStore'

export const TEST_USER_ID = '7d9f3c2a-0000-5000-8000-000000000001'

export const NEXUS_ID = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
export const SECOND_ID = '5c1d2e3f-4a5b-5c6d-8e7f-8091a2b3c4d5'
export const THIRD_ID = '9e8d7c6b-5a49-5382-8716-05f4e3d2c1b0'

export function membership(
  companyId: string,
  overrides: Partial<Omit<WorkspaceMembership, 'company'>> & { name?: string; tradingName?: string; initials?: string } = {},
): WorkspaceMembership {
  const { name = `Company ${companyId.slice(0, 4)}`, tradingName, initials = 'CO', ...rest } = overrides
  return {
    companyId,
    role: 'property_manager',
    isDefault: false,
    joinedAt: '2026-01-05T08:00:00+02:00',
    company: { id: companyId, name, initials, status: 'active', ...(tradingName ? { tradingName } : {}) },
    ...rest,
  }
}

export function profileWith(memberships: WorkspaceMembership[]): CurrentUserProfile {
  return {
    id: TEST_USER_ID,
    fullName: 'Sipho Dlamini',
    email: 'sipho.dlamini@nexussolution.co.za',
    status: 'active',
    memberships,
    createdAt: '2026-01-05T08:00:00+02:00',
    updatedAt: '2026-01-05T08:00:00+02:00',
  }
}

/** Clears the active workspace between tests (the store is module state). */
export function resetWorkspace(): void {
  useAppStore.setState({ activeCompanyId: '' })
}

/** Opens a workspace as the workspace gate would after `GET /me`. */
export function openWorkspace(companyId: string): void {
  useAppStore.getState().setActiveCompany(companyId)
}
