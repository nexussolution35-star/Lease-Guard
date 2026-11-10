import { describe, expect, it } from 'vitest'

import { toInvitation } from './invitations.mapper'
import { ADMIN, COMPANY, INVITATION, invitationRow } from './invitations.test-helpers'

describe('invitations mapper', () => {
  it('maps a pending invitation, dropping null optional fields', () => {
    const invitation = toInvitation(invitationRow)
    expect(invitation).toEqual({
      id: INVITATION,
      companyId: COMPANY,
      email: 'thandi@example.co.za',
      fullName: 'Thandi Mokoena',
      role: 'property_manager',
      status: 'pending',
      invitedByUserId: ADMIN,
      createdAt: invitationRow.created_at,
      updatedAt: invitationRow.updated_at,
    })
  })

  it('keeps the delivery details of a failed or sent invitation', () => {
    expect(
      toInvitation({ ...invitationRow, status: 'failed', failure_reason: 'Email rate limit exceeded', full_name: null, invited_by_user_id: null }),
    ).toMatchObject({ status: 'failed', failureReason: 'Email rate limit exceeded' })
    const sent = toInvitation({ ...invitationRow, status: 'sent', sent_at: '2026-11-09T08:01:00+00:00', invited_user_id: ADMIN })
    expect(sent).toMatchObject({ status: 'sent', sentAt: '2026-11-09T08:01:00+00:00', invitedUserId: ADMIN })
  })

  it('refuses a status the domain does not know', () => {
    expect(() => toInvitation({ ...invitationRow, status: 'expired' })).toThrow(/Unknown invitation status/)
  })

  it('maps every database status, including declined', () => {
    for (const status of ['pending', 'sent', 'accepted', 'revoked', 'declined', 'failed'] as const) {
      const row = { ...invitationRow, status, ...(status === 'failed' ? { failure_reason: 'x' } : {}) }
      expect(toInvitation(row).status).toBe(status)
    }
  })
})
