import { Module } from '@nestjs/common'

import { PropertiesController } from './properties.controller'
import { PropertiesService } from './properties.service'

/** Properties of the active company: read, create, edit, archive and restore. */
@Module({ controllers: [PropertiesController], providers: [PropertiesService], exports: [PropertiesService] })
export class PropertiesModule {}
