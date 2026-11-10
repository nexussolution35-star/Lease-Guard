import { Module } from '@nestjs/common'

import { PropertiesController } from './properties.controller'
import { PropertiesService } from './properties.service'

/** Properties of the active company (read). */
@Module({ controllers: [PropertiesController], providers: [PropertiesService], exports: [PropertiesService] })
export class PropertiesModule {}
