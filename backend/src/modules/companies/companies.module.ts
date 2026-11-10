import { Module } from '@nestjs/common'

import { CompaniesController } from './companies.controller'
import { CompaniesService } from './companies.service'

/** Companies (workspaces) the caller belongs to (read). */
@Module({ controllers: [CompaniesController], providers: [CompaniesService], exports: [CompaniesService] })
export class CompaniesModule {}
