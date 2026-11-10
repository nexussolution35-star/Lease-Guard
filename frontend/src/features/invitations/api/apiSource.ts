import { unwrap, type ApiClient } from '@leaseguard/api-client'

import type { MyInvitationSource } from './source'

/** The signed-in user's invitations from the LeaseGuard API. */
export function createApiMyInvitationSource(api: ApiClient): MyInvitationSource {
  return {
    list() {
      return unwrap(api.GET('/api/v1/me/invitations'))
    },
    accept(invitationId) {
      return unwrap(api.POST('/api/v1/me/invitations/{invitationId}/accept', { params: { path: { invitationId } } }))
    },
    async decline(invitationId) {
      await unwrap(api.POST('/api/v1/me/invitations/{invitationId}/decline', { params: { path: { invitationId } } }))
    },
  }
}
