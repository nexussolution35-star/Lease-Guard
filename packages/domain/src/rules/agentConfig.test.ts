import { describe, expect, it } from 'vitest'

import { autoReplyWarnings, isClockTime, MAX_OPERATING_PERIODS, operatingHoursProblems } from './agentConfig.js'

describe('isClockTime', () => {
  it('accepts HH:mm from 00:00 to 23:59, and 24:00 only as a closing time', () => {
    expect(isClockTime('00:00')).toBe(true)
    expect(isClockTime('23:59')).toBe(true)
    expect(isClockTime('24:00')).toBe(false)
    expect(isClockTime('24:00', { closing: true })).toBe(true)
    expect(isClockTime('8:00')).toBe(false)
    expect(isClockTime('12:60')).toBe(false)
  })
})

describe('operatingHoursProblems', () => {
  it('has none for ordinary office hours, several periods a day and no hours at all', () => {
    expect(operatingHoursProblems([])).toEqual([])
    expect(
      operatingHoursProblems([
        { day: 'monday', opens: '08:00', closes: '12:30' },
        { day: 'monday', opens: '13:30', closes: '17:00' },
        { day: 'saturday', opens: '09:00', closes: '24:00' },
      ]),
    ).toEqual([])
  })

  it('needs each period to close after it opens', () => {
    expect(operatingHoursProblems([{ day: 'friday', opens: '17:00', closes: '08:00' }])).toEqual(['Friday: closing time must be after opening time'])
    expect(operatingHoursProblems([{ day: 'friday', opens: '08:00', closes: '08:00' }])).toHaveLength(1)
  })

  it('refuses times that are not HH:mm', () => {
    expect(operatingHoursProblems([{ day: 'tuesday', opens: '8am', closes: '17:00' }])).toEqual(['Tuesday: use 24-hour times such as 08:00'])
  })

  it('refuses overlapping periods on one day, but not on different days', () => {
    expect(
      operatingHoursProblems([
        { day: 'monday', opens: '08:00', closes: '13:00' },
        { day: 'monday', opens: '12:00', closes: '17:00' },
      ]),
    ).toEqual(['Monday: opening periods overlap'])
    expect(
      operatingHoursProblems([
        { day: 'monday', opens: '08:00', closes: '13:00' },
        { day: 'tuesday', opens: '12:00', closes: '17:00' },
      ]),
    ).toEqual([])
  })

  it(`allows at most ${MAX_OPERATING_PERIODS} periods`, () => {
    const many = Array.from({ length: MAX_OPERATING_PERIODS + 1 }, (_, i) => ({ day: 'monday' as const, opens: `0${i % 10}:00`, closes: `0${i % 10}:30` }))
    expect(operatingHoursProblems(many)).toContain(`At most ${MAX_OPERATING_PERIODS} opening periods`)
  })
})

describe('autoReplyWarnings', () => {
  it('has none while auto-reply is off', () => {
    expect(autoReplyWarnings({ autoReplyEnabled: false, permittedActions: [], operatingHours: [] })).toEqual([])
  })

  it('warns when auto-reply is on but the agent may not answer anything, or is never open', () => {
    expect(autoReplyWarnings({ autoReplyEnabled: true, permittedActions: ['draft_tenant_reply'], operatingHours: [] })).toEqual([
      'Auto-reply is on, but no action lets the agent answer contacts, so every message goes to a person.',
      'No operating hours are set, so contacts only ever get the out-of-hours message.',
    ])
    expect(
      autoReplyWarnings({ autoReplyEnabled: true, permittedActions: ['answer_faq'], operatingHours: [{ day: 'monday', opens: '08:00', closes: '17:00' }] }),
    ).toEqual([])
  })
})
