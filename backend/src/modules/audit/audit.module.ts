import { Module } from '@nestjs/common'

import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'

/** The company's append-only audit log (read). */
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
