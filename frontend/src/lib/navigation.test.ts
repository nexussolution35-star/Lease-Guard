import { describe, expect, it } from 'vitest'

import { breadcrumbsFor, entityHref, isNavItemActive, NAV_ITEMS, NAV_SECTIONS } from '@/lib/navigation'

describe('NAV_SECTIONS', () => {
  it('has unique ids and routes', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(NAV_ITEMS.length)
    expect(new Set(NAV_ITEMS.map((i) => i.to)).size).toBe(NAV_ITEMS.length)
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      'Overview',
      'Portfolio',
      'Operations',
      'Communication',
      'Insights',
      'Admin',
    ])
  })
})

describe('isNavItemActive', () => {
  it('matches the item route and nested routes', () => {
    expect(isNavItemActive({ to: '/leases' }, '/leases')).toBe(true)
    expect(isNavItemActive({ to: '/leases' }, '/leases/lease_1')).toBe(true)
    expect(isNavItemActive({ to: '/leases' }, '/leasesx')).toBe(false)
  })

  it('only matches the dashboard exactly', () => {
    expect(isNavItemActive({ to: '/' }, '/')).toBe(true)
    expect(isNavItemActive({ to: '/' }, '/properties')).toBe(false)
  })
})

describe('breadcrumbsFor', () => {
  it('returns Dashboard for the root', () => {
    expect(breadcrumbsFor('/')).toEqual([{ label: 'Dashboard' }])
  })

  it('uses nav labels for top-level sections', () => {
    expect(breadcrumbsFor('/properties')).toEqual([{ label: 'Properties' }])
    expect(breadcrumbsFor('/whatsapp/')).toEqual([{ label: 'WhatsApp' }])
  })

  it('links every crumb but the last', () => {
    expect(breadcrumbsFor('/statements/upload')).toEqual([
      { label: 'Statements', to: '/statements' },
      { label: 'Upload' },
    ])
    expect(breadcrumbsFor('/settings/audit')).toEqual([
      { label: 'Settings', to: '/settings' },
      { label: 'Audit log' },
    ])
    expect(breadcrumbsFor('/settings/integrations/whatsapp')).toEqual([
      { label: 'Settings', to: '/settings' },
      { label: 'Integrations', to: '/settings/integrations' },
      { label: 'WhatsApp' },
    ])
  })

  it('resolves record labels through resolvers keyed by parent segment', () => {
    const crumbs = breadcrumbsFor('/properties/prop_mall', {
      properties: (id) => (id === 'prop_mall' ? 'Mall of Soweto' : undefined),
    })
    expect(crumbs).toEqual([{ label: 'Properties', to: '/properties' }, { label: 'Mall of Soweto' }])
  })

  it('falls back to a readable segment when no resolver matches', () => {
    expect(breadcrumbsFor('/leases/lease_0001').at(-1)).toEqual({ label: 'Lease 0001' })
  })
})

describe('entityHref', () => {
  it('builds detail and list routes', () => {
    expect(entityHref('lease', 'lease_1')).toBe('/leases/lease_1')
    expect(entityHref('monitoring_event', 'evt_1')).toBe('/monitoring/evt_1')
    expect(entityHref('communication', 'com_1')).toBe('/communications')
    expect(entityHref('notification', 'n_1')).toBeUndefined()
  })
})
