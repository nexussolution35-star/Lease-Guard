import { Module } from '@nestjs/common'

import { LeasesController } from './leases.controller'
import { LeasesService } from './leases.service'

/** Leases of the active company: read, and verification of lease terms. */
@Module({ controllers: [LeasesController], providers: [LeasesService], exports: [LeasesService] })
export class LeasesModule {}
