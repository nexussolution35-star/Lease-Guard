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

/** Toast copy for a failed invitation action (create errors are shown on the form instead). */
export function invitationActionError(action: 'revoke' | 'resend', error: unknown): MemberErrorCopy {
  return {
    title: action === 'revoke' ? 'Could not revoke the invitation' : 'Could not resend the invitation',
    description: describeApiError(error, 'Try again in a moment.'),
  }
}
