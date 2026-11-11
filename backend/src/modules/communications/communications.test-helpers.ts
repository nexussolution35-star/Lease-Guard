import type { CommunicationRow, MessageApprovalRow } from './communications.mapper'

/** Shared rows for the communications tests (not a test file itself: excluded from the build as *.test-helpers.ts). */
export const COMPANY = '6f1d2c1e-0000-4000-8000-000000000001'
export const MANAGER = '6f1d2c1e-0000-4000-8000-0000000000a1'
export const REQUESTER = '6f1d2c1e-0000-4000-8000-0000000000a2'
export const TENANT = '6f1d2c1e-0000-4000-8000-0000000000c1'
export const OWNER = '6f1d2c1e-0000-4000-8000-0000000000c2'
export const MESSAGE = '6f1d2c1e-0000-4000-8000-0000000000d1'
export const APPROVAL = '6f1d2c1e-0000-4000-8000-0000000000e1'

const TS = '2026-11-08T08:00:00+00:00'

export function communicationRow(overrides: Partial<CommunicationRow> = {}): CommunicationRow {
  return {
    id: MESSAGE,
    company_id: COMPANY,
    channel: 'whatsapp',
    direction: 'outbound',
    message_type: 'overdue_payment_reminder',
    recipient_type: 'tenant',
    tenant_id: TENANT,
    owner_user_id: null,
    property_id: null,
    lease_id: null,
    statement_id: null,
    arrangement_id: null,
    template_id: null,
    counterparty_number: '+27821234567',
    company_number: '+27110000000',
    body: 'Hi Lucky, your rental account has R12,500.00 outstanding. Please contact our office with any questions.',
    attachment_file_name: null,
    attachment_storage_path: null,
    attachment_mime_type: null,
    attachment_size_bytes: null,
    attachment_sha256: null,
    status: 'pending_approval',
    external_message_id: null,
    created_by_user_id: REQUESTER,
    sent_at: null,
    delivered_at: null,
    read_at: null,
    failure_reason: null,
    send_uncertain_since: null,
    contact_id: null,
    conversation_id: null,
    received_at: null,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  }
}

export function approvalRow(overrides: Partial<MessageApprovalRow> = {}): MessageApprovalRow {
  return {
    id: APPROVAL,
    company_id: COMPANY,
    communication_id: MESSAGE,
    requested_by_user_id: REQUESTER,
    requested_at: TS,
    decision: 'pending',
    decided_by_user_id: null,
    decided_by_agent_run_id: null,
    decided_at: null,
    reason: null,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  }
}
