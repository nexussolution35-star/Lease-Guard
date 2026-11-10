import { Module } from '@nestjs/common'

import { CommunicationsController } from './communications.controller'
import { CommunicationsService } from './communications.service'
import { MessageApprovalsService } from './message-approvals.service'

/**
 * Message log and the approval workflow of the active company. MessageApprovalsService needs the
 * global QueueProducer (QueuesModule) to hand approved messages to the delivery queue.
 */
@Module({
  controllers: [CommunicationsController],
  providers: [CommunicationsService, MessageApprovalsService],
  exports: [CommunicationsService, MessageApprovalsService],
})
export class CommunicationsModule {}
