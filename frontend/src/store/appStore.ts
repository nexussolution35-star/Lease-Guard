import { create } from 'zustand'

import type { EntityId } from '@leaseguard/domain'

/**
 * Client-only application state: the active company workspace. Every record comes from the LeaseGuard
 * API; nothing here is persisted (the last workspace per user is remembered separately, see
 * `features/account/rememberedWorkspace`).
 */
export interface AppState {
  /** The active workspace's company id; '' until the workspace gate has loaded `GET /me`. */
  activeCompanyId: EntityId | ''
  /** Opens a workspace ('' clears it, e.g. after sign-out or a removed membership). */
  setActiveCompany: (companyId: EntityId | '') => void
}

export const useAppStore = create<AppState>()((set, get) => ({
  activeCompanyId: '',
  setActiveCompany(companyId) {
    if (get().activeCompanyId !== companyId) set({ activeCompanyId: companyId })
  },
}))

/** Active company id, or null when no workspace is selected yet. */
export const selectActiveCompanyIdOrNull = (state: AppState): EntityId | null =>
  state.activeCompanyId === '' ? null : state.activeCompanyId

export function getActiveCompanyIdOrNull(): EntityId | null {
  return selectActiveCompanyIdOrNull(useAppStore.getState())
}
