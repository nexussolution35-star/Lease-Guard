import { Module } from '@nestjs/common'

import { StorageModule } from '../../infrastructure/storage/storage.module'
import { StatementArrearsController } from './statement-arrears.controller'
import { StatementArrearsService } from './statement-arrears.service'
import { StatementReviewController } from './statement-review.controller'
import { StatementReviewService } from './statement-review.service'
import { StatementUploadsService } from './statement-uploads.service'
import { StatementVerificationController } from './statement-verification.controller'
import { StatementVerificationService } from './statement-verification.service'
import { StatementsController } from './statements.controller'
import { StatementsService } from './statements.service'

/**
 * Tenant statements of the active company: read, extraction proposals, and the upload flow
 * (signed upload, registration with duplicate detection, processing queue), and review (original file,
 * field corrections and confirmations, tenant/unit/lease match), and its outcome (verify, reject, mark as duplicate).
 * Needs the global QueuesModule and DatabaseModule.
 */
@Module({
  imports: [StorageModule],
  // StatementArrearsController first: its static path must win over `statements/:statementId`.
  controllers: [StatementArrearsController, StatementsController, StatementReviewController, StatementVerificationController],
  providers: [StatementsService, StatementUploadsService, StatementArrearsService, StatementReviewService, StatementVerificationService],
  exports: [StatementsService, StatementArrearsService],
})
export class StatementsModule {}
