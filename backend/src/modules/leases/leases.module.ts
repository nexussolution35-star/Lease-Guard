import { Module } from '@nestjs/common'

import { StorageModule } from '../../infrastructure/storage/storage.module'
import { LeaseDocumentsController } from './lease-documents.controller'
import { LeaseDocumentsService } from './lease-documents.service'
import { LeasesController } from './leases.controller'
import { LeasesService } from './leases.service'

/** Leases of the active company: read, write, verification of lease terms, and the documents of a lease (upload, list, download). */
@Module({
  imports: [StorageModule],
  controllers: [LeasesController, LeaseDocumentsController],
  providers: [LeasesService, LeaseDocumentsService],
  exports: [LeasesService],
})
export class LeasesModule {}
