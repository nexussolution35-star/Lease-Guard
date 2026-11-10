import { Module } from '@nestjs/common'

import { MonitoringController } from './monitoring.controller'
import { MonitoringService } from './monitoring.service'

/** Monitoring events of the active company (read, status changes). */
@Module({ controllers: [MonitoringController], providers: [MonitoringService], exports: [MonitoringService] })
export class MonitoringModule {}
