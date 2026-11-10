import 'reflect-metadata'
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { COMPANY_ROLES_KEY } from '../../common/guards/company-role.guard'
import { MyInvitationsController } from './my-invitations.controller'

/** @nestjs/swagger metadata keys (DECORATORS.API_SECURITY / API_OPERATION; not exported). */
const API_SECURITY = 'swagger/apiSecurity'
const API_OPERATION = 'swagger/apiOperation'

const handlers = MyInvitationsController.prototype

describe('MyInvitationsController', () => {
  it('is signed-in only: bearer token, no company header, no company guards or roles', () => {
    expect(Reflect.getMetadata(API_SECURITY, MyInvitationsController)).toEqual([{ bearer: [] }])
    expect(Reflect.getMetadata(GUARDS_METADATA, MyInvitationsController)).toBeUndefined()
    expect(Reflect.getMetadata(COMPANY_ROLES_KEY, MyInvitationsController)).toBeUndefined()
    expect(Reflect.getMetadata(PATH_METADATA, MyInvitationsController)).toBe('me/invitations')
  })

  it.each([
    ['list', RequestMethod.GET, '/', 'listMyInvitations'],
    ['accept', RequestMethod.POST, ':invitationId/accept', 'acceptInvitation'],
    ['decline', RequestMethod.POST, ':invitationId/decline', 'declineInvitation'],
  ] as const)('%s is %s %s with operationId %s', (name, method, path, operationId) => {
    const handler = handlers[name]
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method)
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path)
    expect(Reflect.getMetadata(API_OPERATION, handler)).toMatchObject({ operationId })
  })
})
