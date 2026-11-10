import type {
  CreateInvitationDto,
  InvitationDto,
  InvitationSortField,
  InvitationStatus,
  UserDto,
  UserRole,
  UserSortField,
  UserStatus,
} from '@leaseguard/api-client'
import type { EntityId } from '@leaseguard/domain'

import type { ListParams, Page } from '@/lib/data/listParams'

/** A member of the active company; `memberships` holds only that company's membership. */
export type CompanyMember = UserDto

/** An invitation to join the active company, as company admins see it. */
export type CompanyInvitation = InvitationDto

/** `POST /invitations` body: email, role and an optional name for the email greeting. */
export type NewInvitation = CreateInvitationDto

export interface MemberListParams extends ListParams<UserSortField> {
  role?: UserRole
  status?: UserStatus
}

export interface InvitationListParams extends ListParams<InvitationSortField> {
  status?: InvitationStatus
}

/**
 * Members and invitations of one company (company-scoped; the company is explicit so a request always
 * matches its query key). Listing members is open to every member; everything else is for company
 * admins, which the API enforces.
 */
export interface UserSource {
  listMembers(companyId: EntityId, params: MemberListParams): Promise<Page<CompanyMember>>
  /** Rejects with 403 for the caller's own role and 409 when the company would lose its last admin. */
  updateMemberRole(companyId: EntityId, userId: EntityId, role: UserRole): Promise<CompanyMember>
  /** Rejects with 403 for the caller and 409 for the last admin or a member still named on records. */
  removeMember(companyId: EntityId, userId: EntityId): Promise<void>
  listInvitations(companyId: EntityId, params: InvitationListParams): Promise<Page<CompanyInvitation>>
  /** Rejects with 409 when the email has an open invitation or already belongs to a member. */
  createInvitation(companyId: EntityId, invitation: NewInvitation): Promise<CompanyInvitation>
  revokeInvitation(companyId: EntityId, invitationId: EntityId): Promise<CompanyInvitation>
  resendInvitation(companyId: EntityId, invitationId: EntityId): Promise<CompanyInvitation>
}
