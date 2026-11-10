import type { EntityId } from '@leaseguard/domain'

import type { WorkspaceMembership } from './api/source'

export type WorkspaceResolution = { status: 'ready'; companyId: EntityId } | { status: 'no-access' }

/**
 * Which company workspace to open for the signed-in user. Keeps the workspace already
 * selected in this tab, then the one remembered from a previous visit, as long as the user is still a
 * member there; otherwise opens the default membership (or the first one). The API lists memberships
 * default-first, but the default is looked up explicitly rather than relying on that order.
 */
export function resolveWorkspace(
  memberships: readonly WorkspaceMembership[],
  current: EntityId | null,
  remembered: EntityId | null,
): WorkspaceResolution {
  for (const candidate of [current, remembered]) {
    if (candidate && memberships.some((m) => m.companyId === candidate)) return { status: 'ready', companyId: candidate }
  }
  const fallback = memberships.find((m) => m.isDefault) ?? memberships[0]
  return fallback ? { status: 'ready', companyId: fallback.companyId } : { status: 'no-access' }
}

/** The membership for one company, if the user has one. */
export function membershipIn(
  memberships: readonly WorkspaceMembership[],
  companyId: EntityId | null,
): WorkspaceMembership | undefined {
  return companyId ? memberships.find((m) => m.companyId === companyId) : undefined
}

/** Display name of a membership's company (trading name first). */
export function workspaceName(membership: WorkspaceMembership): string {
  return membership.company.tradingName ?? membership.company.name
}

/** Memberships for the switcher: alphabetical by display name (en-ZA collation). */
export function sortedMemberships(memberships: readonly WorkspaceMembership[]): WorkspaceMembership[] {
  return [...memberships].sort((a, b) => workspaceName(a).localeCompare(workspaceName(b), 'en-ZA'))
}
