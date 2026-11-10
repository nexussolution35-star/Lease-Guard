import { Module } from '@nestjs/common'

import { InvitationsController } from './invitations.controller'
import { InvitationsService } from './invitations.service'
import { MyInvitationsController } from './my-invitations.controller'
import { MyInvitationsService } from './my-invitations.service'

/**
 * Invitations to join the active company (company admins) and the caller's own invitations
 * (`/me/invitations`: list, accept, decline). Needs the global QueueProducer (QueuesModule): creating or
 * resending an invitation queues it for the worker to send. Only accepting creates a membership.
 */
@Module({
  controllers: [InvitationsController, MyInvitationsController],
  providers: [InvitationsService, MyInvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
