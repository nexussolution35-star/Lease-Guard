import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class LivenessResponse {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok'

  @ApiProperty({ description: 'Seconds since the API process started.' })
  uptimeSeconds!: number
}

export const DEPENDENCY_STATUSES = ['up', 'down', 'not_configured'] as const
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number]

export class DependencyCheck {
  @ApiProperty({ enum: DEPENDENCY_STATUSES })
  status!: DependencyStatus

  @ApiPropertyOptional({ description: 'Round-trip time of the check, when the dependency answered.' })
  latencyMs?: number

  @ApiPropertyOptional({ description: 'Short reason when the dependency is not up. Details are in the server log.' })
  reason?: string
}

export class ReadinessChecks {
  @ApiProperty({ type: DependencyCheck })
  redis!: DependencyCheck

  @ApiProperty({ type: DependencyCheck })
  supabase!: DependencyCheck
}

export class ReadinessResponse {
  @ApiProperty({ enum: ['ready', 'not_ready'] })
  status!: 'ready' | 'not_ready'

  @ApiProperty({ type: ReadinessChecks })
  checks!: ReadinessChecks
}
