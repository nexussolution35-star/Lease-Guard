import { describe, expect, it } from 'vitest'

import { areSimilarTenantNames, tenantNameKey } from './tenantNameMatch.js'

describe('tenantNameKey', () => {
  it('keeps the identifying words only', () => {
    expect(tenantNameKey('Bean There Coffee (Pty) Ltd')).toBe('bean there coffee')
    expect(tenantNameKey('THE BEAN-THERE COFFEE CC')).toBe('bean there coffee')
    expect(tenantNameKey('Smith & Sons t/a Smith Hardware')).toBe('smith and sons smith hardware')
    expect(tenantNameKey('Café Olé')).toBe('cafe ole')
    expect(tenantNameKey('(Pty) Ltd')).toBe('')
  })
})

describe('areSimilarTenantNames', () => {
  it('finds the same business written differently', () => {
    expect(areSimilarTenantNames('Bean There Coffee', 'Bean There Coffee (Pty) Ltd')).toBe(true)
    expect(areSimilarTenantNames('bean there coffee', 'BEAN THERE COFFEE')).toBe(true)
    expect(areSimilarTenantNames('Bean There', 'Bean There Coffee')).toBe(true)
    expect(areSimilarTenantNames('Bean Thera Coffee', 'Bean There Coffee')).toBe(true)
  })

  it('does not find different businesses', () => {
    expect(areSimilarTenantNames('Bean There Coffee', 'Seattle Coffee Company')).toBe(false)
    expect(areSimilarTenantNames('Pick n Pay', 'Pep')).toBe(false)
    expect(areSimilarTenantNames('KFC', 'KFG')).toBe(false)
    expect(areSimilarTenantNames('(Pty) Ltd', 'Ltd')).toBe(false)
  })
})
