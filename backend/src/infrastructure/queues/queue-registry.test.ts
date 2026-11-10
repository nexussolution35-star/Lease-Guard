import { describe, expect, it } from 'vitest'

import { companyIdOf, DAILY_MONITORING_QUEUES, jobIdFor, MONITORING_DISPATCH_SCHEDULE, processedMarkerKey, QUEUE_NAMES } from './queue-registry'

describe('queue registry', () => {
  it('lists the LeaseGuard queues, each with a processor in the worker', () => {
    expect(QUEUE_NAMES).toEqual([
      'statement-processing',
      'lease-monitoring',
      'arrears-monitoring',
      'arrangement-reminders',
      'message-delivery',
      'monitoring-dispatch',
      'user-invitations',
      'whatsapp-number-verification',
    ])
  })

  it('derives the same job id for the same unit of work', () => {
    const payload = { companyId: 'c1', asOf: '2026-11-07' }
    expect(jobIdFor('lease-monitoring', payload)).toBe('lease-monitoring.c1.2026-11-07')
    expect(jobIdFor('lease-monitoring', { ...payload })).toBe(jobIdFor('lease-monitoring', payload))
    expect(jobIdFor('arrears-monitoring', payload)).not.toBe(jobIdFor('lease-monitoring', payload))
  })

  it('derives one job id for the same record whatever the case of its uuids', () => {
    const company = '0b6c7c38-3f43-4e0e-8f1e-2d5b1f6f9a01'
    const message = '6f1d2c1e-0000-4000-8000-0000000000d1'
    const lower = jobIdFor('message-delivery', { companyId: company, communicationId: message })
    expect(jobIdFor('message-delivery', { companyId: company.toUpperCase(), communicationId: message.toUpperCase() })).toBe(lower)
    expect(lower).toBe(`message-delivery.${company}.${message}`)
  })

  it('identifies an invitation send by its company and invitation', () => {
    const company = '0b6c7c38-3f43-4e0e-8f1e-2d5b1f6f9a01'
    const invitation = '6f1d2c1e-0000-4000-8000-0000000000e1'
    expect(jobIdFor('user-invitations', { companyId: company, invitationId: invitation })).toBe(`user-invitations.${company}.${invitation}`)
    expect(jobIdFor('user-invitations', { companyId: company.toUpperCase(), invitationId: invitation.toUpperCase() })).toBe(
      jobIdFor('user-invitations', { companyId: company, invitationId: invitation }),
    )
    expect(companyIdOf({ companyId: company, invitationId: invitation })).toBe(company)
  })

  it('never produces the BullMQ-reserved ":" in a job id', () => {
    expect(jobIdFor('message-delivery', { companyId: 'a:b', communicationId: 'x:y' })).not.toContain(':')
  })

  it('identifies a manual dispatch by its date and refuses one without a date', () => {
    expect(jobIdFor('monitoring-dispatch', { asOf: '2026-11-09' })).toBe('monitoring-dispatch.2026-11-09')
    expect(() => jobIdFor('monitoring-dispatch', {})).toThrow(/"asOf" is missing/)
  })

  it('fans the dispatch out to the three daily company scans at 06:00 South African time', () => {
    expect(DAILY_MONITORING_QUEUES).toEqual(['lease-monitoring', 'arrears-monitoring', 'arrangement-reminders'])
    expect(MONITORING_DISPATCH_SCHEDULE).toMatchObject({ pattern: '0 6 * * *', tz: 'Africa/Johannesburg' })
  })

  it('reads the company of a company-scoped payload only', () => {
    expect(companyIdOf({ companyId: 'c1', statementId: 's1' })).toBe('c1')
    expect(companyIdOf({ asOf: '2026-11-09' })).toBeUndefined()
  })

  it('names the processed marker the idempotent worker writes and the producer clears', () => {
    const jobId = 'statement-processing.c1.s1'
    expect(processedMarkerKey('leaseguard', 'statement-processing', jobId)).toBe('leaseguard:processed:statement-processing:statement-processing.c1.s1')
  })
})
