import { ConflictException, Injectable } from '@nestjs/common'
import type { CompanyInvitation, EntityId, InvitationStatus } from '@leaseguard/domain'

import { httpErrorFromDatabase, unwrapDatabase, type DatabaseErrorOverrides } from '../../common/http/database-errors'
import { emptyPageWithTotal, isPageOutOfRange, rangeFor, searchFilter, toPage, type Page } from '../../common/http/pagination'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { QueueProducer } from '../../infrastructure/queues/queue-producer'
import { toInvitation, type InvitationRow } from './invitations.mapper'
import {
  INVITATION_SORT_COLUMNS,
  RESENDABLE_INVITATION_STATUSES,
  REVOCABLE_INVITATION_STATUSES,
  type CreateInvitationBody,
  type InvitationListQuery,
} from './invitations.schemas'

const SEARCH_COLUMNS = ['email', 'full_name'] as const

/** The partial unique index allows one open (pending or sent) invitation per company and email. */
const CREATE_OVERRIDES: DatabaseErrorOverrides = {
  '23505': () => new ConflictException('This email already has an open invitation to the company; resend or revoke it instead'),
}

function isOneOf<const S extends readonly InvitationStatus[]>(statuses: S, status: InvitationStatus): status is S[number] {
  return statuses.includes(status)
}

/**
 * Invitations to join the active company. Only company admins may read or change them (enforced by
 * the route roles and by Row Level Security). Creating and resending hand the invitation to the
 * worker's 'user-invitations' queue, which sends it through Supabase Auth with the service role and
 * records the outcome (status sent / failed); the API never sends emails itself. Neither sending nor
 * revoking touches memberships: the invitee joins only by accepting (`MyInvitationsService.accept`).
 */
@Injectable()
export class InvitationsService {
  constructor(private readonly queues: QueueProducer) {}

  async list(db: DbClient, companyId: EntityId, query: InvitationListQuery): Promise<Page<CompanyInvitation>> {
    const filtered = () => {
      let request = db.from('company_invitations').select('*', { count: 'exact' }).eq('company_id', companyId)
      if (query.status) request = request.eq('status', query.status)
      if (query.search) request = request.or(searchFilter(SEARCH_COLUMNS, query.search))
      return request
    }

    const sortColumn = INVITATION_SORT_COLUMNS[query.sort ?? 'createdAt']
    const { data, error, count } = await filtered()
      .order(sortColumn, { ascending: query.direction === 'asc' })
      .order('id', { ascending: true })
      .range(...rangeFor(query))
    if (error) {
      if (isPageOutOfRange(error)) return emptyPageWithTotal(filtered().range(0, 0), query, 'List invitations')
      throw httpErrorFromDatabase(error, 'List invitations')
    }
    return toPage(data, count, query, toInvitation)
  }

  /**
   * Records a pending invitation (the database stamps the inviter from the caller's token) and queues
   * it for sending. An email that already belongs to a member of the company is refused (409): such an
   * invitation could never change anything, because accepting keeps an existing member's role.
   */
  async create(db: DbClient, companyId: EntityId, body: CreateInvitationBody): Promise<CompanyInvitation> {
    await this.assertNotMember(db, companyId, body.email)
    const row = unwrapDatabase(
      await db
        .from('company_invitations')
        .insert({ company_id: companyId, email: body.email, role: body.role, full_name: body.fullName ?? null })
        .select('*')
        .single(),
      'Create invitation',
      CREATE_OVERRIDES,
    )
    await this.queues.enqueue('user-invitations', { companyId, invitationId: row.id })
    return toInvitation(row)
  }

  /**
   * Withdraws a pending or sent invitation; it can no longer be accepted. There is no membership to
   * clean up: memberships are created only on acceptance.
   */
  async revoke(db: DbClient, companyId: EntityId, invitationId: EntityId): Promise<CompanyInvitation> {
    const current = toInvitation(await this.load(db, companyId, invitationId))
    if (!isOneOf(REVOCABLE_INVITATION_STATUSES, current.status)) {
      throw new ConflictException(`Only a pending or sent invitation can be revoked (this one is ${current.status})`)
    }
    const { data, error } = await db
      .from('company_invitations')
      .update({ status: 'revoked' })
      .eq('company_id', companyId)
      .eq('id', invitationId)
      .in('status', REVOCABLE_INVITATION_STATUSES)
      .select('*')
      .maybeSingle()
    if (error) throw httpErrorFromDatabase(error, 'Revoke invitation')
    if (!data) throw new ConflictException('The invitation changed while it was being revoked; reload it')
    return toInvitation(data)
  }

  /**
   * Sends a pending, sent or failed invitation again by re-queueing its job (a pending one whose first
   * job was never queued is recovered this way). The status does not change here (signed-in users
   * cannot set it): the worker resets a failed invitation and records the new send. Never touches
   * memberships.
   */
  async resend(db: DbClient, companyId: EntityId, invitationId: EntityId): Promise<CompanyInvitation> {
    const invitation = toInvitation(await this.load(db, companyId, invitationId))
    if (!isOneOf(RESENDABLE_INVITATION_STATUSES, invitation.status)) {
      throw new ConflictException(`Only a pending, sent or failed invitation can be resent (this one is ${invitation.status})`)
    }
    await this.queues.enqueueOrRetry('user-invitations', { companyId, invitationId: invitation.id })
    return invitation
  }

  private async load(db: DbClient, companyId: EntityId, invitationId: EntityId): Promise<InvitationRow> {
    return unwrapDatabase(
      await db.from('company_invitations').select('*').eq('company_id', companyId).eq('id', invitationId).maybeSingle(),
      'Get invitation',
    )
  }

  /**
   * Compares the invitation email with the members' profile emails, which the caller (a company admin)
   * can read through RLS because members are colleagues. Limitation: profiles.email is a copy of the
   * auth email kept by triggers, and the API holds no service role to read auth.users, so a member whose
   * copy is stale would not be detected here. That is harmless: accepting never changes an existing
   * member's role, and the invitation then only stays open until it is revoked or declined.
   */
  private async assertNotMember(db: DbClient, companyId: EntityId, email: string): Promise<void> {
    const { data, error } = await db
      .from('company_users')
      .select('user_id, profile:profiles!inner(email)')
      .eq('company_id', companyId)
      .eq('profile.email', email)
      .limit(1)
    if (error) throw httpErrorFromDatabase(error, 'Check existing membership')
    if ((data ?? []).length > 0) throw new ConflictException('This email already belongs to a member of the company')
  }
}
