import type { EntityId } from '@leaseguard/domain'

/**
 * Query keys for one entity. Every key starts with the entity name and the ACTIVE COMPANY id, so
 * switching workspace never serves another company's cached records, and one prefix invalidates all.
 */
export function createEntityKeys<const TEntity extends string>(entity: TEntity) {
  return {
    all: [entity] as const,
    company: (companyId: EntityId) => [entity, companyId] as const,
    lists: (companyId: EntityId) => [entity, companyId, 'list'] as const,
    list: <TParams extends object>(companyId: EntityId, params: TParams) => [entity, companyId, 'list', params] as const,
    details: (companyId: EntityId) => [entity, companyId, 'detail'] as const,
    detail: (companyId: EntityId, id: EntityId) => [entity, companyId, 'detail', id] as const,
  }
}

export type EntityKeys<TEntity extends string> = ReturnType<typeof createEntityKeys<TEntity>>
