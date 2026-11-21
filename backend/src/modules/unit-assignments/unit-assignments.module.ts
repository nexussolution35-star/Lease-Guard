import { Module } from '@nestjs/common'

import { UnitAssignmentsController } from './unit-assignments.controller'
import { UnitAssignmentsService } from './unit-assignments.service'

/** Tenants assigned to units without a lease: list, assign and unassign. */
@Module({ controllers: [UnitAssignmentsController], providers: [UnitAssignmentsService] })
export class UnitAssignmentsModule {}
