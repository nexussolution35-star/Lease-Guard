import { Injectable } from '@nestjs/common'
import { type AuthError, isAuthRetryableFetchError, type User } from '@supabase/supabase-js'

import { ServiceRoleClientFactory } from '../database/service-role-client.factory'

/** The parts of a Supabase Auth user the invitation flow needs. */
export interface AuthUserSummary {
  id: string
  email: string | null
  /** True once the user has used an invite / confirmation link (auth.users.email_confirmed_at is set). */
  emailConfirmed: boolean
}

export type InviteResult =
  /** Supabase Auth created (or re-invited an unconfirmed) user and sent the invitation email. */
  | { kind: 'invited'; user: AuthUserSummary }
  /** A confirmed user with this email already exists; no email was sent. */
  | { kind: 'exists' }

export interface InviteOptions {
  /** Stored as user metadata `full_name` (the profile trigger and the email template read it). */
  fullName?: string | null
  /** Where the invitation link lands; must be in the Auth redirect allow-list. */
  redirectTo: string
}

/** Supabase Auth admin operations used by the worker. Implemented over the service-role client. */
export interface AuthAdmin {
  inviteUserByEmail(email: string, options: InviteOptions): Promise<InviteResult>
  getUserById(id: string): Promise<AuthUserSummary | null>
  /** Pages through the users (the admin API has no lookup by email); for fallbacks only. */
  findUserByEmail(email: string): Promise<AuthUserSummary | null>
}

/** HTTP statuses after which the same request may succeed later. */
const RETRYABLE_STATUSES = new Set([408, 429])
/** Codes Supabase Auth returns when a user with the email already exists. */
const USER_EXISTS_CODES = new Set(['email_exists', 'user_already_exists'])

/** A Supabase Auth admin call failed. `retryable` says whether the job should retry it. */
export class AuthAdminError extends Error {
  readonly status: number | undefined
  readonly code: string | undefined
  readonly retryable: boolean

  constructor(operation: string, error: AuthError) {
    super(`${operation} failed${error.status ? ` (HTTP ${error.status}${error.code ? `, ${error.code}` : ''})` : ''}: ${error.message}`)
    this.name = 'AuthAdminError'
    this.status = error.status
    this.code = error.code
    this.retryable =
      isAuthRetryableFetchError(error) || error.status === undefined || error.status === 0 || error.status >= 500 || RETRYABLE_STATUSES.has(error.status)
  }
}

export function toAuthUserSummary(user: Pick<User, 'id' | 'email' | 'email_confirmed_at'>): AuthUserSummary {
  return { id: user.id, email: user.email ?? null, emailConfirmed: Boolean(user.email_confirmed_at) }
}

const LIST_PAGE_SIZE = 1000
/** Upper bound on listUsers pages (1 000 000 users), so a misbehaving API can never loop forever. */
const MAX_LIST_PAGES = 1000

/**
 * Auth admin API over the worker's service-role client. Only the worker may construct it (the API
 * process never holds the service-role key).
 */
@Injectable()
export class SupabaseAuthAdmin implements AuthAdmin {
  constructor(private readonly clients: ServiceRoleClientFactory) {}

  private get admin() {
    return this.clients.get().auth.admin
  }

  async inviteUserByEmail(email: string, options: InviteOptions): Promise<InviteResult> {
    const { data, error } = await this.admin.inviteUserByEmail(email, {
      redirectTo: options.redirectTo,
      ...(options.fullName ? { data: { full_name: options.fullName } } : {}),
    })
    if (error) {
      if (error.code !== undefined && USER_EXISTS_CODES.has(error.code)) return { kind: 'exists' }
      throw new AuthAdminError('Send invitation email', error)
    }
    return { kind: 'invited', user: toAuthUserSummary(data.user) }
  }

  async getUserById(id: string): Promise<AuthUserSummary | null> {
    const { data, error } = await this.admin.getUserById(id)
    if (error) {
      if (error.status === 404 || error.code === 'user_not_found') return null
      throw new AuthAdminError('Load auth user', error)
    }
    return toAuthUserSummary(data.user)
  }

  async findUserByEmail(email: string): Promise<AuthUserSummary | null> {
    const wanted = email.trim().toLowerCase()
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const { data, error } = await this.admin.listUsers({ page, perPage: LIST_PAGE_SIZE })
      if (error) throw new AuthAdminError('List auth users', error)
      const match = data.users.find((user) => user.email?.toLowerCase() === wanted)
      if (match) return toAuthUserSummary(match)
      if (data.users.length < LIST_PAGE_SIZE) return null
    }
    return null
  }
}
