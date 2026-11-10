import { Module } from '@nestjs/common'

import { TenantsController } from './tenants.controller'
import { TenantsService } from './tenants.service'

/** Tenants of the active company (read). */
@Module({ controllers: [TenantsController], providers: [TenantsService], exports: [TenantsService] })
export class TenantsModule {}
