import { Module } from '@nestjs/common'

import { UnitsController } from './units.controller'
import { UnitsService } from './units.service'

/** Units of the active company: read, create and edit. */
@Module({ controllers: [UnitsController], providers: [UnitsService], exports: [UnitsService] })
export class UnitsModule {}
