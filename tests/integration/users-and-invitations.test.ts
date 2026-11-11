import { unwrap } from '@leaseguard/api-client'
import { afterAll, describe, expect, it } from 'vitest'

import { apiAs, apiErrorOf, expectOk, integration, serviceRole, world } from './support/clients.ts'

/**
 * Settings → Users through the real API: every member reads the member list; company admins manage members (never
 * themselves) and invitations (invite, resend, revoke) with clear 403 and 409 answers. The last-admin rule itself is
 * covered in pgTAP (supabase/tests/auth_onboarding.test.sql): an admin can never be the one acting on the last admin.
 */

const inviteEmail = (label: string) => `invitee-${label}.${integration().runId}@leaseguard.test`

afterAll(async () => {
  // The world's cleanup empties company tables too; remove this file's invitations explicitly anyway.
  expectOk(
    await serviceRole().from('company_invitations').delete().like('email', `invitee-%.${integration().runId}@leaseguard.test`),
    'Delete this file’s invitations',
  )
})

describe('Settings → Users: members', () => {
  it('lets every member of the company read the member list, with roles and statuses', async () => {
    const page = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/users', { params: { query: { pageSize: 100 } } }))
    const admin = page.items.find((member) => member.id === world().users.admin.id)
    expect(admin).toMatchObject({ email: world().users.admin.email, status: 'active', memberships: [{ companyId: world().companies.a.id, role: 'company_admin' }] })
    expect(page.items.every((member) => member.memberships.length === 1 && member.memberships[0]?.companyId === world().companies.a.id)).toBe(true)
  })

  it('counts the active company admins with the role and status filters', async () => {
    const page = await unwrap(apiAs('admin', 'a').GET('/api/v1/users', { params: { query: { pageSize: 1, role: 'company_admin', status: 'active' } } }))
    expect(page.total).toBe(1)
  })

  it('refuses an admin changing their own role or removing themselves (403)', async () => {
    const self = world().users.admin.id
    const role = await apiErrorOf(unwrap(apiAs('admin', 'a').PATCH('/api/v1/users/{userId}/role', { params: { path: { userId: self } }, body: { role: 'read_only' } })))
    expect(role.status).toBe(403)
    expect(role.messages.join(' ')).toMatch(/cannot change your own role/)
    const remove = await apiErrorOf(unwrap(apiAs('admin', 'a').DELETE('/api/v1/users/{userId}', { params: { path: { userId: self } } })))
    expect(remove.status).toBe(403)
    expect(remove.messages.join(' ')).toMatch(/cannot remove yourself/)
  })

  it('refuses member management to other roles (403)', async () => {
    const error = await apiErrorOf(
      unwrap(apiAs('manager', 'a').PATCH('/api/v1/users/{userId}/role', { params: { path: { userId: world().users.readOnly.id } }, body: { role: 'company_admin' } })),
    )
    expect(error.status).toBe(403)
  })

  it('lets an admin change another member’s role and back', async () => {
    const userId = world().users.readOnly.id
    try {
      const changed = await unwrap(apiAs('admin', 'a').PATCH('/api/v1/users/{userId}/role', { params: { path: { userId } }, body: { role: 'property_owner' } }))
      expect(changed.memberships[0]?.role).toBe('property_owner')
    } finally {
      await unwrap(apiAs('admin', 'a').PATCH('/api/v1/users/{userId}/role', { params: { path: { userId } }, body: { role: 'read_only' } }))
    }
  })

  it('refuses removing a member still named on company records (409)', async () => {
    // The world's manager manages company A's properties.
    const error = await apiErrorOf(unwrap(apiAs('admin', 'a').DELETE('/api/v1/users/{userId}', { params: { path: { userId: world().users.manager.id } } })))
    expect(error.status).toBe(409)
    expect(error.messages.join(' ')).toMatch(/still assigned to company records/)
  })
})

describe('Settings → Users: invitations', () => {
  it('invites, refuses a duplicate, resends and revokes with clear outcomes', async () => {
    const admin = apiAs('admin', 'a')
    const email = inviteEmail('flow')
    const created = await unwrap(admin.POST('/api/v1/invitations', { body: { email: email.toUpperCase(), role: 'property_manager', fullName: 'Lerato Invitee' } }))
    expect(created).toMatchObject({ email, role: 'property_manager', status: 'pending', companyId: world().companies.a.id })

    const duplicate = await apiErrorOf(unwrap(admin.POST('/api/v1/invitations', { body: { email, role: 'read_only' } })))
    expect(duplicate.status).toBe(409)
    expect(duplicate.messages.join(' ')).toMatch(/already has an open invitation/)

    const listed = await unwrap(admin.GET('/api/v1/invitations', { params: { query: { search: email } } }))
    expect(listed.items.map((invitation) => invitation.id)).toEqual([created.id])

    const resent = await unwrap(admin.POST('/api/v1/invitations/{invitationId}/resend', { params: { path: { invitationId: created.id } } }))
    expect(resent.id).toBe(created.id)

    const revoked = await unwrap(admin.POST('/api/v1/invitations/{invitationId}/revoke', { params: { path: { invitationId: created.id } } }))
    expect(revoked.status).toBe('revoked')

    const again = await apiErrorOf(unwrap(admin.POST('/api/v1/invitations/{invitationId}/revoke', { params: { path: { invitationId: created.id } } })))
    expect(again.status).toBe(409)
    expect(again.messages.join(' ')).toMatch(/this one is revoked/)
    const resendRevoked = await apiErrorOf(unwrap(admin.POST('/api/v1/invitations/{invitationId}/resend', { params: { path: { invitationId: created.id } } })))
    expect(resendRevoked.status).toBe(409)
  })

  it('refuses inviting an existing member (409)', async () => {
    const error = await apiErrorOf(unwrap(apiAs('admin', 'a').POST('/api/v1/invitations', { body: { email: world().users.readOnly.email, role: 'read_only' } })))
    expect(error.status).toBe(409)
    expect(error.messages.join(' ')).toMatch(/already belongs to a member/)
  })

  it('keeps invitations away from other roles and other companies', async () => {
    expect((await apiErrorOf(unwrap(apiAs('readOnly', 'a').GET('/api/v1/invitations', {})))).status).toBe(403)
    expect((await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/invitations', { body: { email: inviteEmail('pm'), role: 'read_only' } })))).status).toBe(403)
    // The admin of A is not a member of B.
    expect((await apiErrorOf(unwrap(apiAs('admin', 'b').GET('/api/v1/invitations', {})))).status).toBe(403)
  })
})
