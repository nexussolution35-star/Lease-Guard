import { Module } from '@nestjs/common'

import { CommunicationAnalyticsService } from './communication-analytics.service'
import { CommunicationsController } from './communications.controller'
import { CommunicationsService } from './communications.service'
import { MessageApprovalsService } from './message-approvals.service'

/**
 * Message log, the approval workflow and communication analytics of the active company. MessageApprovalsService needs the
 * global QueueProducer (QueuesModule) to hand approved messages to the delivery queue.
 */
@Module({
  controllers: [CommunicationsController],
  providers: [CommunicationsService, MessageApprovalsService, CommunicationAnalyticsService],
  exports: [CommunicationsService, MessageApprovalsService],
})
export class CommunicationsModule {}
