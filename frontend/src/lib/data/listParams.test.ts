import { describe, expect, it } from 'vitest'

import { lastPageWhenPastEnd, listSearchTerm, MAX_LIST_SEARCH_LENGTH, pageCountOf } from './listParams'

describe('pageCountOf', () => {
  it('is at least one page', () => {
    expect(pageCountOf({ total: 0, pageSize: 25 })).toBe(1)
    expect(pageCountOf({ total: 26, pageSize: 25 })).toBe(2)
  })
})

describe('lastPageWhenPastEnd', () => {
  it('returns the last page for a page past the end of a non-empty list', () => {
    expect(lastPageWhenPastEnd(3, { total: 10, pageSize: 25 })).toBe(1)
    expect(lastPageWhenPastEnd(9, { total: 51, pageSize: 25 })).toBe(3)
  })

  it('returns null for an in-range page or an empty list', () => {
    expect(lastPageWhenPastEnd(1, { total: 10, pageSize: 25 })).toBeNull()
    expect(lastPageWhenPastEnd(3, { total: 51, pageSize: 25 })).toBeNull()
    expect(lastPageWhenPastEnd(3, { total: 0, pageSize: 25 })).toBeNull()
  })
})

describe('listSearchTerm', () => {
  it('trims and drops blank searches', () => {
    expect(listSearchTerm(' mall ')).toBe('mall')
    expect(listSearchTerm('   ')).toBeUndefined()
    expect(listSearchTerm(undefined)).toBeUndefined()
  })

  it('caps the term at the API search limit', () => {
    expect(listSearchTerm(`  ${'a'.repeat(150)}`)).toBe('a'.repeat(MAX_LIST_SEARCH_LENGTH))
    expect(listSearchTerm(`${'a'.repeat(99)}  b`)).toBe('a'.repeat(99))
  })

  it('never cuts a surrogate pair in half at the limit', () => {
    // An emoji is two UTF-16 units; cutting between them leaves a lone surrogate that cannot be URL-encoded.
    const term = listSearchTerm(`${'a'.repeat(99)}\u{1F600}`)
    expect(term).toBe('a'.repeat(99))
    expect(() => encodeURIComponent(term ?? '')).not.toThrow()
    expect(listSearchTerm(`${'a'.repeat(98)}\u{1F600}`)).toBe(`${'a'.repeat(98)}\u{1F600}`)
    expect(listSearchTerm(`${'a'.repeat(98)} \u{1F600}`)).toBe('a'.repeat(98))
  })
})
