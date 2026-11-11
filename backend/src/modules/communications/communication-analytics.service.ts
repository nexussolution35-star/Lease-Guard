import { BadRequestException, Injectable } from '@nestjs/common'
import {
  communicationAnalyticsRangeProblem,
  defaultCommunicationAnalyticsRange,
  type CommunicationAnalytics,
  type CommunicationAnalyticsRange,
  type EntityId,
  type ISODate,
} from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import { saToday } from '../../common/sa-today'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'

/**
 * A company's WhatsApp communication figures over South African calendar days (both inclusive), computed by the
 * database (`communication_analytics`) with the caller's client: it refuses non-members and Row Level Security applies
 * to everything it counts.
 */
@Injectable()
export class CommunicationAnalyticsService {
  /**
   * Without dates: the last 30 days, today included. A start alone runs to today; an end alone covers the 30 days up
   * to it. `now` is the clock (tests pass one).
   */
  async figures(db: DbClient, companyId: EntityId, requested: { from?: ISODate; to?: ISODate }, now: Date = new Date()): Promise<CommunicationAnalytics> {
    const range = resolveRange(requested, saToday(now))
    const problem = communicationAnalyticsRangeProblem(range)
    if (problem) throw new BadRequestException(problem)

    const { data, error } = await db.rpc('communication_analytics', { p_company_id: companyId, p_from: range.from, p_to: range.to })
    if (error) {
      throw httpErrorFromDatabase(error, 'Read communication analytics', { '22023': (e) => new BadRequestException(e.message) })
    }
    const row = data?.[0]
    return {
      ...range,
      inbound: row?.inbound_messages ?? 0,
      outbound: row?.outbound_messages ?? 0,
      delivered: row?.delivered_messages ?? 0,
      read: row?.read_messages ?? 0,
      failed: row?.failed_messages ?? 0,
      handovers: row?.handovers_opened ?? 0,
      agentHandovers: row?.handovers_by_agent ?? 0,
      agentReplies: row?.agent_replies ?? 0,
      outOfHoursMessages: row?.out_of_hours_messages ?? 0,
      suggestedReplies: row?.suggested_replies ?? 0,
    }
  }
}

function resolveRange(requested: { from?: ISODate; to?: ISODate }, today: ISODate): CommunicationAnalyticsRange {
  if (requested.from && requested.to) return { from: requested.from, to: requested.to }
  if (requested.from) return { from: requested.from, to: today }
  return defaultCommunicationAnalyticsRange(requested.to ?? today)
}
