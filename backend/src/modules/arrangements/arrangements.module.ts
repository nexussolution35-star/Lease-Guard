import { Module } from '@nestjs/common'

import { ArrangementsController } from './arrangements.controller'
import { ArrangementsService } from './arrangements.service'

/** Payment arrangements of the active company (read-only monitoring records; no payment processing). */
@Module({ controllers: [ArrangementsController], providers: [ArrangementsService], exports: [ArrangementsService] })
export class ArrangementsModule {}
