import { Module } from '@nestjs/common'

import { StorageModule } from '../../infrastructure/storage/storage.module'
import { StatementUploadsService } from './statement-uploads.service'
import { StatementsController } from './statements.controller'
import { StatementsService } from './statements.service'

/**
 * Tenant statements of the active company: read, extraction proposals, and the upload flow
 * (signed upload, registration with duplicate detection, processing queue).
 * Needs the global QueuesModule and DatabaseModule.
 */
@Module({
  imports: [StorageModule],
  controllers: [StatementsController],
  providers: [StatementsService, StatementUploadsService],
  exports: [StatementsService],
})
export class StatementsModule {}
