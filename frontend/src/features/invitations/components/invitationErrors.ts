import { isApiError } from '@leaseguard/api-client'

import { describeApiError } from '@/lib/data/apiErrors'

export interface InvitationErrorCopy {
  title: string
  description: string
}

/**
 * Toast copy for a failed accept or decline. The API answers 404 for any invitation that is not the
 * caller's open invitation (revoked, already answered, or sent to another address).
 */
export function invitationAnswerError(action: 'accept' | 'decline', error: unknown): InvitationErrorCopy {
  if (isApiError(error) && error.isNotFound) {
    return {
      title: 'This invitation is no longer available',
      description: 'It may have been revoked, or already accepted or declined.',
    }
  }
  return {
    title: action === 'accept' ? 'Could not accept the invitation' : 'Could not decline the invitation',
    description: describeApiError(error, 'Try again in a moment.'),
  }
}
