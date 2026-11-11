import type { EntityId } from '@leaseguard/domain'

import { useActiveCompanyId } from './useActiveCompanyId'

/**
 * The active company id for a mutation, read when the mutation runs. Mutations only run from screens inside an open
 * workspace, so a missing company is a programming error, not a state to render.
 */
export function useActiveCompanyOrThrow(): () => EntityId {
  const companyId = useActiveCompanyId()
  return () => {
    if (companyId === null) throw new Error('No workspace is selected.')
    return companyId
  }
}
