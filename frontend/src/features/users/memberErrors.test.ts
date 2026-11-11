import { ApiError } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { inviteError, invitationActionError, memberActionError } from './memberErrors'

const apiError = (status: number, message?: string) => new ApiError(status, message ? [message] : [], null)

describe('memberActionError', () => {
  it('explains a refused change of your own role (403)', () => {
    expect(memberActionError('role', apiError(403))).toEqual({
      title: 'Could not change the role',
      description: 'You cannot change your own role. Another company admin must do it.',
    })
  })

  it('shows the API’s own reason for a 403 when it gives one', () => {
    expect(memberActionError('remove', apiError(403, 'only a company admin can change member roles')).description).toBe(
      'Only a company admin can change member roles.',
    )
  })

  it('explains the last-admin conflict (409)', () => {
    expect(memberActionError('remove', apiError(409)).description).toBe(
      'The company must keep at least one active company admin. Make another member a company admin first.',
    )
  })

  it('says when the member has already left (404)', () => {
    expect(memberActionError('role', apiError(404)).description).toBe('This member is no longer part of the workspace.')
  })
})

describe('invitationActionError', () => {
  it('explains a 409: the invitation was already answered or revoked', () => {
    expect(invitationActionError('revoke', apiError(409, 'Only a pending or sent invitation can be revoked (this one is accepted)'))).toEqual({
      title: 'Could not revoke the invitation',
      description: 'Only a pending or sent invitation can be revoked (this one is accepted). The list has been refreshed.',
    })
  })

  it('explains a 403: only company admins manage invitations', () => {
    expect(invitationActionError('resend', apiError(403)).description).toBe('Only company admins can manage invitations.')
  })

  it('says when the invitation no longer exists (404)', () => {
    expect(invitationActionError('resend', apiError(404)).description).toBe('This invitation no longer exists. The list has been refreshed.')
  })

  it('falls back for server errors', () => {
    expect(invitationActionError('resend', apiError(503)).description).toBe('Try again in a moment.')
  })
})

describe('inviteError', () => {
  it('puts a conflict (open invitation or existing member) on the email field', () => {
    expect(inviteError(apiError(409, 'This email already belongs to a member of the company'))).toEqual({
      field: 'email',
      message: 'This email already belongs to a member of the company.',
    })
  })

  it('explains a 403', () => {
    expect(inviteError(apiError(403))).toEqual({ field: 'root', message: 'Only company admins can invite people.' })
  })

  it('falls back for anything else', () => {
    expect(inviteError(new Error('boom'))).toEqual({ field: 'root', message: 'The invitation could not be created. Try again in a moment.' })
  })
})
