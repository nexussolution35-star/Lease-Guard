import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'

class LivenessResponse {
  status!: 'ok'
  uptimeSeconds!: number
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  /** Liveness: the process is running and serving HTTP. Dependency readiness is checked separately. */
  @Get()
  @ApiOkResponse({ type: LivenessResponse })
  liveness(): LivenessResponse {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) }
  }
}
