import { describe, expect, it } from 'vitest'

import { createEntityKeys } from './queryKeys'

describe('createEntityKeys', () => {
  it('scopes every key by entity and company', () => {
    const keys = createEntityKeys('properties')
    expect(keys.list('cmp-1', { page: 1 })).toEqual(['properties', 'cmp-1', 'list', { page: 1 }])
    expect(keys.detail('cmp-1', 'p-1')).toEqual(['properties', 'cmp-1', 'detail', 'p-1'])
    expect(keys.list('cmp-1', {}).slice(0, 3)).toEqual(keys.lists('cmp-1'))
    expect(keys.detail('cmp-2', 'p-1')).not.toEqual(keys.detail('cmp-1', 'p-1'))
  })
})
