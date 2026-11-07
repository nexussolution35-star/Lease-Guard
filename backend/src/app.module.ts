import { Module } from '@nestjs/common'

import { HealthController } from './infrastructure/health/health.controller'

@Module({
  controllers: [HealthController],
})
export class AppModule {}
