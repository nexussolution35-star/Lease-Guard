import { Module } from '@nestjs/common'

import { StorageModule } from '../../infrastructure/storage/storage.module'
import { WhatsAppAgentController } from './whatsapp-agent.controller'
import { WhatsAppAgentService } from './whatsapp-agent.service'
import { WhatsAppKnowledgeService } from './whatsapp-knowledge.service'

/** The active company's AI agent configuration and knowledge base (ticket 09): members read, company admins write. */
@Module({ imports: [StorageModule], controllers: [WhatsAppAgentController], providers: [WhatsAppAgentService, WhatsAppKnowledgeService] })
export class WhatsAppAgentModule {}
