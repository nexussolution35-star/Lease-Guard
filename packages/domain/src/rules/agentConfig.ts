import type { AgentOperatingPeriod, AgentPermittedAction } from '../types/index.js'

/**
 * Rules for a company's AI agent configuration (ticket 09), shared by the API's validation and the settings form.
 * The database enforces the same shape (private.is_agent_operating_hours) without the overlap rule.
 */

/** At most two periods a day. */
export const MAX_OPERATING_PERIODS = 14

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** `HH:mm`, 00:00–23:59; a closing time may also be `24:00` (midnight at the end of the day). */
export function isClockTime(value: string, options: { closing?: boolean } = {}): boolean {
  return CLOCK_TIME.test(value) || (options.closing === true && value === '24:00')
}

function dayLabel(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1)
}

/** Every problem with a set of operating hours, as sentences for the person who set them; empty when valid. */
export function operatingHoursProblems(periods: readonly AgentOperatingPeriod[]): string[] {
  const problems: string[] = []
  if (periods.length > MAX_OPERATING_PERIODS) problems.push(`At most ${MAX_OPERATING_PERIODS} opening periods`)
  const valid: AgentOperatingPeriod[] = []
  for (const period of periods) {
    if (!isClockTime(period.opens) || !isClockTime(period.closes, { closing: true })) {
      problems.push(`${dayLabel(period.day)}: use 24-hour times such as 08:00`)
    } else if (period.opens >= period.closes) {
      problems.push(`${dayLabel(period.day)}: closing time must be after opening time`)
    } else {
      valid.push(period)
    }
  }
  const overlapping = new Set<string>()
  for (const [i, a] of valid.entries()) {
    for (const b of valid.slice(i + 1)) {
      if (a.day === b.day && a.opens < b.closes && b.opens < a.closes) overlapping.add(a.day)
    }
  }
  for (const day of overlapping) problems.push(`${dayLabel(day)}: opening periods overlap`)
  return problems
}

/** Actions that let the agent send a contact an answer (the rest only draft or capture). */
const ANSWERING_ACTIONS: readonly AgentPermittedAction[] = ['answer_faq', 'share_business_info', 'share_approved_document']

/**
 * Settings that make auto-reply do less than the admin probably expects. Not errors: saving is allowed, the agent
 * then simply hands every message to a person.
 */
export function autoReplyWarnings(config: {
  autoReplyEnabled: boolean
  permittedActions: readonly AgentPermittedAction[]
  operatingHours: readonly AgentOperatingPeriod[]
}): string[] {
  if (!config.autoReplyEnabled) return []
  const warnings: string[] = []
  if (!config.permittedActions.some((action) => ANSWERING_ACTIONS.includes(action))) {
    warnings.push('Auto-reply is on, but no action lets the agent answer contacts, so every message goes to a person.')
  }
  if (config.operatingHours.length === 0) {
    warnings.push('No operating hours are set, so contacts only ever get the out-of-hours message.')
  }
  return warnings
}
