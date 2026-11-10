import { describe, expect, it } from 'vitest'

import { membership, NEXUS_ID, SECOND_ID, THIRD_ID } from '@/test/accountFixtures'

import { membershipIn, resolveWorkspace, sortedMemberships, workspaceName } from './workspace'

const nexus = membership(NEXUS_ID, { name: 'Nexus Solution (Pty) Ltd', tradingName: 'Nexus Solution', role: 'property_manager' })
const second = membership(SECOND_ID, { name: 'Acacia Property Group', isDefault: true, role: 'read_only' })
const third = membership(THIRD_ID, { name: 'Baobab Estates' })

describe('resolveWorkspace', () => {
  it('opens the default membership when nothing is selected or remembered', () => {
    expect(resolveWorkspace([nexus, second, third], null, null)).toEqual({ status: 'ready', companyId: SECOND_ID })
  })

  it('falls back to the first membership when none is marked default', () => {
    expect(resolveWorkspace([third, nexus], null, null)).toEqual({ status: 'ready', companyId: THIRD_ID })
  })

  it('keeps the workspace already selected while the user is still a member', () => {
    expect(resolveWorkspace([nexus, second, third], THIRD_ID, NEXUS_ID)).toEqual({ status: 'ready', companyId: THIRD_ID })
  })

  it('reopens the remembered workspace when nothing is selected yet', () => {
    expect(resolveWorkspace([nexus, second], null, NEXUS_ID)).toEqual({ status: 'ready', companyId: NEXUS_ID })
  })

  it('ignores a selected or remembered company the user no longer belongs to', () => {
    expect(resolveWorkspace([nexus, second], THIRD_ID, THIRD_ID)).toEqual({ status: 'ready', companyId: SECOND_ID })
    expect(resolveWorkspace([nexus], 'demo-company', null)).toEqual({ status: 'ready', companyId: NEXUS_ID })
  })

  it('reports no access without memberships', () => {
    expect(resolveWorkspace([], NEXUS_ID, NEXUS_ID)).toEqual({ status: 'no-access' })
  })
})

describe('membership helpers', () => {
  it('finds the membership for a company', () => {
    expect(membershipIn([nexus, second], SECOND_ID)?.role).toBe('read_only')
    expect(membershipIn([nexus, second], THIRD_ID)).toBeUndefined()
    expect(membershipIn([nexus, second], null)).toBeUndefined()
  })

  it('names a workspace by trading name first and sorts by display name', () => {
    expect(workspaceName(nexus)).toBe('Nexus Solution')
    expect(workspaceName(second)).toBe('Acacia Property Group')
    expect(sortedMemberships([nexus, third, second]).map(workspaceName)).toEqual(['Acacia Property Group', 'Baobab Estates', 'Nexus Solution'])
  })
})
