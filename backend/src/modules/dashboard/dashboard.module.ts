import { Module } from '@nestjs/common'

import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'

/** The dashboard figures of the active company (read only; the balances with the statements arrears summary's rules). */
@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
