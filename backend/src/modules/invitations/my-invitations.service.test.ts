import { ForbiddenException, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import type { ReceivedInvitationRow } from './my-invitations.mapper'
import { MyInvitationsService } from './my-invitations.service'
import { COMPANY, INVITATION } from './invitations.test-helpers'

type RpcResult = { data: unknown; error: { code: string; message: string } | null }

/** A caller's RLS client whose only use is `rpc`; `from` must never be called. */
function rpcClient(result: RpcResult) {
  const rpc = vi.fn(async () => result)
  const from = vi.fn(() => {
    throw new Error('table access is not expected')
  })
  return { db: { rpc, from } as unknown as DbClient, rpc, from }
}

const NOT_AVAILABLE = { code: '42501', message: 'This invitation is not available' }

const receivedRow: ReceivedInvitationRow = {
  id: INVITATION,
  company_id: COMPANY,
  company_name: 'Acme Properties',
  role: 'property_manager',
  invited_by_name: 'Sipho Dlamini',
  created_at: '2026-11-09T08:00:00+00:00',
}

describe('MyInvitationsService.list', () => {
  it("returns the caller's open invitations from list_my_company_invitations", async () => {
    const { db, rpc } = rpcClient({ data: [receivedRow, { ...receivedRow, id: 'other', invited_by_name: null }], error: null })
    await expect(new MyInvitationsService().list(db)).resolves.toEqual([
      {
        id: INVITATION,
        companyId: COMPANY,
        companyName: 'Acme Properties',
        role: 'property_manager',
        invitedByName: 'Sipho Dlamini',
        createdAt: '2026-11-09T08:00:00+00:00',
      },
      { id: 'other', companyId: COMPANY, companyName: 'Acme Properties', role: 'property_manager', createdAt: '2026-11-09T08:00:00+00:00' },
    ])
    expect(rpc).toHaveBeenCalledWith('list_my_company_invitations')
  })

  it('returns an empty list when the caller has none', async () => {
    const { db } = rpcClient({ data: null, error: null })
    await expect(new MyInvitationsService().list(db)).resolves.toEqual([])
  })

  it('maps an unreachable database to 503', async () => {
    const { db } = rpcClient({ data: null, error: { code: 'PGRST002', message: 'schema cache' } })
    await expect(new MyInvitationsService().list(db)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

describe('MyInvitationsService.accept', () => {
  it('accepts through accept_company_invitation and returns the joined company', async () => {
    const { db, rpc, from } = rpcClient({ data: COMPANY, error: null })
    await expect(new MyInvitationsService().accept(db, INVITATION)).resolves.toEqual({ companyId: COMPANY })
    expect(rpc).toHaveBeenCalledWith('accept_company_invitation', { p_invitation_id: INVITATION })
    expect(from).not.toHaveBeenCalled()
  })

  it('answers 404 "Invitation not found" for the generic refusal, revealing nothing else', async () => {
    const { db } = rpcClient({ data: null, error: NOT_AVAILABLE })
    const error = await new MyInvitationsService().accept(db, INVITATION).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NotFoundException)
    expect((error as NotFoundException).message).toBe('Invitation not found')
  })

  it('answers 404 when the function returns no company', async () => {
    const { db } = rpcClient({ data: null, error: null })
    await expect(new MyInvitationsService().accept(db, INVITATION)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('maps an unreachable database to 503', async () => {
    const { db } = rpcClient({ data: null, error: { code: 'PGRST001', message: 'no connection' } })
    await expect(new MyInvitationsService().accept(db, INVITATION)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

describe('MyInvitationsService.decline', () => {
  it('declines through decline_company_invitation', async () => {
    const { db, rpc, from } = rpcClient({ data: null, error: null })
    await expect(new MyInvitationsService().decline(db, INVITATION)).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('decline_company_invitation', { p_invitation_id: INVITATION })
    expect(from).not.toHaveBeenCalled()
  })

  it('answers 404 for the generic refusal', async () => {
    const { db } = rpcClient({ data: null, error: NOT_AVAILABLE })
    await expect(new MyInvitationsService().decline(db, INVITATION)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('answers 404, never 403, for any 42501 (no enumeration through the status code)', async () => {
    const { db } = rpcClient({ data: null, error: { code: '42501', message: 'permission denied for function decline_company_invitation' } })
    const error = await new MyInvitationsService().decline(db, INVITATION).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NotFoundException)
    expect(error).not.toBeInstanceOf(ForbiddenException)
  })

  it('keeps the default mapping for other database errors', async () => {
    const { db } = rpcClient({ data: null, error: { code: 'P0001', message: 'some rule' } })
    await expect(new MyInvitationsService().decline(db, INVITATION)).rejects.toBeInstanceOf(UnprocessableEntityException)
  })
})
