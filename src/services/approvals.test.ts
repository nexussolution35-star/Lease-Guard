import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { APPROVAL_IDS, COMMUNICATION_IDS, DEMO_COMPANY_IDS, DEMO_REFERENCE_DATE, TENANT_IDS } from '@/data'
import { useAppStore } from '@/store/appStore'

import {
  approveApproval,
  getApprovalDetails,
  listApprovalHistory,
  listApprovalQueue,
  rejectApproval,
  useApprovalQueue,
} from '@/services/approvals'
import { draftTenantMessage, getCommunication } from '@/services/communications'

const TODAY = DEMO_REFERENCE_DATE

beforeEach(() => {
  localStorage.clear()
  useAppStore.getState().resetDemoData()
})

describe('approval queue', () => {
  it('lists pending approvals of the active company with joined context', () => {
    const queue = listApprovalQueue(TODAY)
    expect(queue.map((q) => q.approval.id)).toEqual([APPROVAL_IDS.reminderFollowUpPallet])
    const [item] = queue
    expect(item.communication.id).toBe(COMMUNICATION_IDS.reminderFollowUpPallet)
    expect(item.tenant?.id).toBe(TENANT_IDS.gautengPallet)
    expect(item.template?.messageType).toBe('follow_up_payment_reminder')
    expect(item.requestedBy?.id).toBeDefined()
    expect(item.eligibility.reasons.some((r) => /approval/i.test(r))).toBe(false)
  })

  it('is scoped to the workspace', () => {
    useAppStore.getState().switchWorkspace(DEMO_COMPANY_IDS.second)
    expect(listApprovalQueue(TODAY).map((q) => q.approval.id)).toEqual([APPROVAL_IDS.hcrInstallmentTuks])
    expect(getApprovalDetails(APPROVAL_IDS.reminderFollowUpPallet, TODAY)).toBeUndefined()
  })

  it('details include the audit history', () => {
    const details = getApprovalDetails(APPROVAL_IDS.reminderFollowUpPallet, TODAY)
    expect(details?.approval.decision).toBe('pending')
    expect(Array.isArray(details?.history)).toBe(true)
  })

  it('approve delegates to communications and queues the message', () => {
    const msg = approveApproval(APPROVAL_IDS.reminderFollowUpPallet, 'Checked against statement')
    expect(msg.status).toBe('queued')
    expect(listApprovalQueue(TODAY)).toHaveLength(0)
    expect(listApprovalHistory(TODAY)[0].approval.decision).toBe('approved')
    expect(() => approveApproval(APPROVAL_IDS.reminderFollowUpPallet)).toThrow(/already approved/)
  })

  it('reject requires a reason', () => {
    expect(() => rejectApproval(APPROVAL_IDS.reminderFollowUpPallet, ' ')).toThrow(/reason/)
    const msg = rejectApproval(APPROVAL_IDS.reminderFollowUpPallet, 'Balance already settled')
    expect(msg.status).toBe('rejected')
    expect(getCommunication(COMMUNICATION_IDS.reminderFollowUpPallet)?.status).toBe('rejected')
  })

  it('useApprovalQueue reacts to new drafts', () => {
    const { result } = renderHook(() => useApprovalQueue(TODAY))
    expect(result.current).toHaveLength(1)
    act(() => {
      draftTenantMessage('monthly_statement', TENANT_IDS.thriftyFoods, 'Hi, your statement is attached.')
    })
    expect(result.current).toHaveLength(2)
  })
})
