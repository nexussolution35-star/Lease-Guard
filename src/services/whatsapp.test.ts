import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { COMMUNICATION_IDS, DEMO_COMPANY_IDS, DEMO_REFERENCE_DATE, PROPERTY_IDS, TENANT_IDS, USER_IDS } from '@/data'
import { formatZAR } from '@/domain'
import { useAppStore } from '@/store/appStore'

import { getCommunication, draftTenantMessage, approveMessage } from '@/services/communications'
import { getArrearsReport } from '@/services/reports'
import { setOptOut } from '@/services/tenants'
import {
  answerOwnerQuestion,
  buildOwnerWeeklySummary,
  getChannel,
  getConversationThread,
  getOptOutStatus,
  getSendAttempts,
  getSuppressionStatus,
  listConversations,
  MAX_SEND_ATTEMPTS,
  retryFailedMessage,
  sendApprovedMessage,
  SendRefusedError,
  simulateConnectionCheck,
  simulateDeliveryProgress,
  updateChannelSettings,
  useConversations,
} from '@/services/whatsapp'

const TODAY = DEMO_REFERENCE_DATE

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

describe('channel', () => {
  it('reports the active company configuration and template counts', () => {
    const ch = getChannel()
    expect(ch.companyId).toBe(DEMO_COMPANY_IDS.nexus)
    expect(ch.config.connectionStatus).toBe('connected')
    expect(ch.templates.total).toBe(ch.templates.approved + ch.templates.draft + ch.templates.submitted + ch.templates.rejected)
    expect(JSON.stringify(ch)).not.toMatch(/EAAG|token"\s*:/)
  })

  it('identity changes require re-verification; the check is deterministic', () => {
    expect(updateChannelSettings({ displayName: 'Nexus PM' }).connectionStatus).toBe('connected')
    expect(updateChannelSettings({ phoneNumberId: '999' }).connectionStatus).toBe('pending_verification')
    expect(simulateConnectionCheck().connectionStatus).toBe('connected')
    updateChannelSettings({ webhookConfigured: false })
    expect(simulateConnectionCheck().connectionStatus).toBe('pending_verification')
  })

  it('is scoped to the workspace', () => {
    useAppStore.getState().switchWorkspace(DEMO_COMPANY_IDS.second)
    expect(getChannel().config.connectionStatus).toBe('pending_verification')
    expect(simulateConnectionCheck().connectionStatus).toBe('pending_verification')
  })
})

describe('sending', () => {
  it('sends an approved, eligible message and records a simulated wamid', () => {
    const sent = sendApprovedMessage(COMMUNICATION_IDS.installmentDlaminiNov, TODAY)
    expect(sent.status).toBe('sent')
    expect(sent.externalMessageId).toMatch(/^wamid\.SIM-[0-9A-F]{20}$/)
    expect(getSendAttempts(sent.id)).toBe(1)
    expect(simulateDeliveryProgress(sent.id, 'delivered').status).toBe('delivered')
    expect(simulateDeliveryProgress(sent.id, 'read').readAt).toBeDefined()
    expect(() => simulateDeliveryProgress(sent.id, 'failed')).toThrow(/Cannot move/)
  })

  it('refuses messages that are not approved', () => {
    expect(() => sendApprovedMessage(COMMUNICATION_IDS.reminderFollowUpPallet, TODAY)).toThrow(SendRefusedError)
    expect(() => sendApprovedMessage(COMMUNICATION_IDS.reminderRejectedDlamini, TODAY)).toThrow(/only approved/)
  })

  it('re-checks eligibility at send time (opt-out after approval)', () => {
    setOptOut(TENANT_IDS.dlaminiCellular, true)
    try {
      sendApprovedMessage(COMMUNICATION_IDS.installmentDlaminiNov, TODAY)
      expect.unreachable()
    } catch (e) {
      expect((e as SendRefusedError).reasons).toContain('Tenant has opted out of WhatsApp communication')
    }
  })

  it('refuses arrears reminders suppressed by an active arrangement', () => {
    const { communication } = draftTenantMessage('overdue_payment_reminder', TENANT_IDS.dlaminiCellular, 'Hi Mandla, your balance is overdue.')
    approveMessage(communication.id)
    expect(() => sendApprovedMessage(communication.id, TODAY)).toThrow(/paused by an active payment arrangement/)
  })

  it('refuses when the channel is not connected', () => {
    updateChannelSettings({ webhookConfigured: false })
    expect(() => sendApprovedMessage(COMMUNICATION_IDS.installmentDlaminiNov, TODAY)).toThrow(/channel/)
  })

  it('retries failed messages at most MAX_SEND_ATTEMPTS times', () => {
    const id = COMMUNICATION_IDS.installmentDlaminiNov
    for (let i = 0; i < MAX_SEND_ATTEMPTS; i++) {
      sendApprovedMessage(id, TODAY)
      simulateDeliveryProgress(id, 'failed', 'Number unreachable')
      expect(getCommunication(id)?.failureReason).toBe('Number unreachable')
      if (i < MAX_SEND_ATTEMPTS - 1) expect(retryFailedMessage(id).status).toBe('queued')
    }
    expect(getSendAttempts(id)).toBe(MAX_SEND_ATTEMPTS)
    expect(() => retryFailedMessage(id)).toThrow(/Maximum/)
    expect(() => retryFailedMessage(COMMUNICATION_IDS.stmtThrifty)).toThrow(/Only failed/)
  })
})

describe('conversations and tenant status', () => {
  it('lists one row per counterpart with inbound awaiting replies', () => {
    const rows = listConversations()
    const keys = rows.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    const pallet = rows.find((r) => r.tenantId === TENANT_IDS.gautengPallet)
    expect(pallet?.messageCount).toBe(getConversationThread(`tenant:${TENANT_IDS.gautengPallet}`).length)
    expect(pallet?.pendingApproval).toBe(1)
    expect(rows.some((r) => r.ownerUserId === USER_IDS.pieterOwner)).toBe(true)
    for (const r of rows) expect(r.lastMessage.companyId).toBe(DEMO_COMPANY_IDS.nexus)
  })

  it('useConversations updates on workspace switch', () => {
    const { result } = renderHook(() => useConversations())
    const nexusCount = result.current.length
    act(() => useAppStore.getState().switchWorkspace(DEMO_COMPANY_IDS.second))
    expect(result.current.length).not.toBe(nexusCount)
  })

  it('reports opt-out and suppression from domain rules', () => {
    expect(getOptOutStatus(TENANT_IDS.nkosiNdlovu)).toMatchObject({ optedOut: true, canReceiveMessages: false })
    const s = getSuppressionStatus(TENANT_IDS.dlaminiCellular, 'overdue_payment_reminder', TODAY)
    expect(s.suppressed).toBe(true)
    expect(s.reasons).toContain('Arrears reminders are paused by an active payment arrangement')
    expect(getSuppressionStatus(TENANT_IDS.dlaminiCellular, 'arrangement_installment_reminder', TODAY).suppressed).toBe(false)
    expect(getSuppressionStatus(TENANT_IDS.thriftyFoods, 'owner_weekly_summary', TODAY).suppressed).toBe(true)
  })
})

describe('owner summaries and questions', () => {
  it('weekly summary figures come from the reports', () => {
    const s = buildOwnerWeeklySummary(USER_IDS.pieterOwner, TODAY)
    const arrears = getArrearsReport({ propertyIds: s.propertyIds }, TODAY)
    expect(s.propertyIds.sort()).toEqual([PROPERTY_IDS.dvc, PROPERTY_IDS.msq].sort())
    expect(s.totals.totalOutstanding).toBe(arrears.totalOutstanding)
    expect(s.periodStart).toBe('2026-10-31')
    expect(s.periodEnd).toBe(TODAY)
    expect(s.body).toContain(formatZAR(arrears.totalOutstanding))
    expect(() => buildOwnerWeeklySummary(USER_IDS.siphoPm, TODAY)).toThrow(/not a property owner/)
  })

  it('answers supported questions from figures only', () => {
    const own = getArrearsReport({ propertyIds: [PROPERTY_IDS.dvc, PROPERTY_IDS.msq] }, TODAY)
    const total = answerOwnerQuestion('What is my total outstanding?', USER_IDS.pieterOwner, TODAY)
    expect(total.intent).toBe('total_outstanding')
    expect(total.answer).toContain(formatZAR(own.totalOutstanding))

    const prop = answerOwnerQuestion('How much is outstanding at Meadowlands Square?', USER_IDS.pieterOwner, TODAY)
    expect(prop.intent).toBe('property_outstanding')
    expect(prop.answer).toContain(formatZAR(getArrearsReport({ propertyIds: [PROPERTY_IDS.msq] }, TODAY).totalOutstanding))

    expect(answerOwnerQuestion('Which tenants are overdue?', USER_IDS.pieterOwner, TODAY).intent).toBe('overdue_tenants')
    expect(answerOwnerQuestion('Which leases expire next year?', USER_IDS.pieterOwner, TODAY).answer).toMatch(/2027/)
    expect(answerOwnerQuestion('Leases expiring within 6 months?', USER_IDS.pieterOwner, TODAY).answer).toMatch(/within 6 months/)
    expect(answerOwnerQuestion('What changed this week?', USER_IDS.pieterOwner, TODAY).intent).toBe('weekly_changes')
  })

  it('refuses unsupported questions explicitly and records Q&A only when asked', () => {
    const before = Object.keys(useAppStore.getState().collections.communications).length
    const r = answerOwnerQuestion('Should I sell the building?', USER_IDS.pieterOwner, TODAY)
    expect(r.answered).toBe(false)
    expect(r.answer).toMatch(/^I can't answer that yet/)
    expect(Object.keys(useAppStore.getState().collections.communications).length).toBe(before)

    const rec = answerOwnerQuestion('What is my total outstanding?', USER_IDS.pieterOwner, TODAY, { record: true })
    expect(rec.communications?.map((c) => c.direction)).toEqual(['inbound', 'outbound'])
    expect(rec.communications?.[1].messageType).toBe('owner_query_response')
    expect(Object.keys(useAppStore.getState().collections.communications).length).toBe(before + 2)
  })
})
