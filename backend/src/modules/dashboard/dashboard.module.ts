import { Module } from '@nestjs/common'

import { StatementsModule } from '../statements/statements.module'
import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'

/** The dashboard figures of the active company (read only; the balances come from the statements arrears summary). */
@Module({ imports: [StatementsModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
