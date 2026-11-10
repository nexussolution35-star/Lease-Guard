import { Injectable } from '@nestjs/common'
import type { ISODate } from '@leaseguard/domain'

import { saToday } from '../../common/sa-today'

/** The worker's only source of "now", so processors are deterministic under test. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date()
  }

  /** Today's date in South Africa. */
  today(): ISODate {
    return saToday(this.now())
  }
}
