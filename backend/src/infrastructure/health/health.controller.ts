import { Controller, Get, HttpStatus, Res } from '@nestjs/common'
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { Public } from '../../common/decorators/public.decorator'
import { LivenessResponse, ReadinessResponse } from './health.responses'
import { ReadinessService } from './readiness.service'

/** Served at the root (`/health`), outside the `/api/v1` prefix, for load balancers and orchestrators. */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly readinessService: ReadinessService) {}

  /** Liveness: the process is running and serving HTTP. Dependencies are checked by /health/ready. */
  @Get()
  @ApiOkResponse({ type: LivenessResponse })
  liveness(): LivenessResponse {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) }
  }

  /** Readiness: Redis answers PING and Supabase is reachable. 503 with per-dependency status otherwise. */
  @Get('ready')
  @ApiOkResponse({ type: ReadinessResponse })
  @ApiServiceUnavailableResponse({ type: ReadinessResponse })
  async readiness(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.readinessService.check()
    if (result.status !== 'ready') response.status(HttpStatus.SERVICE_UNAVAILABLE)
    return result
  }
}
