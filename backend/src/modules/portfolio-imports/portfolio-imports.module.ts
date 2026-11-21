import { Module } from '@nestjs/common'

import { StorageModule } from '../../infrastructure/storage/storage.module'
import { PortfolioImportApplyController } from './apply/portfolio-import-apply.controller'
import { PortfolioImportApplyService } from './apply/portfolio-import-apply.service'
import { GoogleSheetsReader } from './google-sheets/google-sheets-reader'
import { PortfolioImportsController } from './portfolio-imports.controller'
import { PortfolioImportsService } from './portfolio-imports.service'
import { PortfolioImportPreviewController } from './preview/portfolio-import-preview.controller'
import { PortfolioImportPreviewService } from './preview/portfolio-import-preview.service'

/**
 * Portfolio import batches (tickets I-01 to I-04, I-06): writers upload a CSV or XLSX file or link a Google Sheet, map
 * its columns, resolve its rows and approve it; members read the batch, its row preview and its summary.
 */
@Module({
  imports: [StorageModule],
  controllers: [PortfolioImportsController, PortfolioImportPreviewController, PortfolioImportApplyController],
  providers: [PortfolioImportsService, GoogleSheetsReader, PortfolioImportPreviewService, PortfolioImportApplyService],
})
export class PortfolioImportsModule {}
