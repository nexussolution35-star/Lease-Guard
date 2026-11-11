import { isApiError } from '@leaseguard/api-client'

import { describeApiError } from '@/lib/data/apiErrors'

export interface MemberErrorCopy {
  title: string
  description: string
}

/**
 * Toast copy for a failed role change or removal. 403: the caller acted on themselves (or is not a
 * company admin); 409: the company would lose its last active admin, or (removal) the member is still
 * named on company records. The API's own message says which, so it is shown when present.
 */
export function memberActionError(action: 'role' | 'remove', error: unknown): MemberErrorCopy {
  const title = action === 'role' ? 'Could not change the role' : 'Could not remove the member'
  if (isApiError(error)) {
    if (error.isForbidden) {
      return {
        title,
        description: describeApiError(
          error,
          action === 'role'
            ? 'You cannot change your own role. Another company admin must do it.'
            : 'You cannot remove yourself. Another company admin must do it.',
        ),
      }
    }
    if (error.status === 409) {
      return {
        title,
        description: describeApiError(error, 'The company must keep at least one active company admin. Make another member a company admin first.'),
      }
    }
    if (error.isNotFound) return { title, description: 'This member is no longer part of the workspace.' }
  }
  return { title, description: describeApiError(error, 'Try again in a moment.') }
}

/**
 * Toast copy for a failed revoke or resend. 409: the invitation was accepted, declined or revoked meanwhile (the
 * API says which); 404: it no longer exists; 403: the caller is no longer a company admin. The list is refreshed
 * after every attempt, so the copy says so.
 */
export function invitationActionError(action: 'revoke' | 'resend', error: unknown): MemberErrorCopy {
  const title = action === 'revoke' ? 'Could not revoke the invitation' : 'Could not resend the invitation'
  if (isApiError(error)) {
    if (error.status === 409) {
      return { title, description: `${describeApiError(error, 'This invitation was already accepted, declined or revoked.')} The list has been refreshed.` }
    }
    if (error.isNotFound) return { title, description: 'This invitation no longer exists. The list has been refreshed.' }
    if (error.isForbidden) return { title, description: 'Only company admins can manage invitations.' }
  }
  return { title, description: describeApiError(error, 'Try again in a moment.') }
}

export interface InviteErrorCopy {
  /** `email` when the address is the problem (open invitation or existing member), otherwise the whole form. */
  field: 'email' | 'root'
  message: string
}

/** Where and how the invite form shows a failed `POST /invitations`. */
export function inviteError(error: unknown): InviteErrorCopy {
  if (isApiError(error)) {
    if (error.status === 409) {
      return { field: 'email', message: describeApiError(error, 'This email already has an open invitation or belongs to a member of the company.') }
    }
    if (error.isForbidden) return { field: 'root', message: 'Only company admins can invite people.' }
  }
  return { field: 'root', message: describeApiError(error, 'The invitation could not be created. Try again in a moment.') }
}
