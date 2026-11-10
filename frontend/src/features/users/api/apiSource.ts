import { COMPANY_ID_HEADER, compactQuery, unwrap, type ApiClient } from '@leaseguard/api-client'

import { listSearchTerm } from '@/lib/data/listParams'

import type { UserSource } from './source'

/** Members (`/api/v1/users`) and invitations (`/api/v1/invitations`) of a company from the LeaseGuard API. */
export function createApiUserSource(api: ApiClient): UserSource {
  const scoped = (companyId: string) => ({ [COMPANY_ID_HEADER]: companyId })
  return {
    listMembers(companyId, params) {
      return unwrap(
        api.GET('/api/v1/users', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              role: params.role,
              status: params.status,
            }),
          },
          headers: scoped(companyId),
        }),
      )
    },
    updateMemberRole(companyId, userId, role) {
      return unwrap(
        api.PATCH('/api/v1/users/{userId}/role', { params: { path: { userId } }, body: { role }, headers: scoped(companyId) }),
      )
    },
    async removeMember(companyId, userId) {
      await unwrap(api.DELETE('/api/v1/users/{userId}', { params: { path: { userId } }, headers: scoped(companyId) }))
    },
    listInvitations(companyId, params) {
      return unwrap(
        api.GET('/api/v1/invitations', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
            }),
          },
          headers: scoped(companyId),
        }),
      )
    },
    createInvitation(companyId, invitation) {
      return unwrap(api.POST('/api/v1/invitations', { body: invitation, headers: scoped(companyId) }))
    },
    revokeInvitation(companyId, invitationId) {
      return unwrap(
        api.POST('/api/v1/invitations/{invitationId}/revoke', { params: { path: { invitationId } }, headers: scoped(companyId) }),
      )
    },
    resendInvitation(companyId, invitationId) {
      return unwrap(
        api.POST('/api/v1/invitations/{invitationId}/resend', { params: { path: { invitationId } }, headers: scoped(companyId) }),
      )
    },
  }
}
