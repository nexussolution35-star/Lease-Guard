import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as domain from '@leaseguard/domain'
import { describe, expect, it } from 'vitest'

import { Constants } from './database.types'

type DbEnumName = keyof typeof Constants.public.Enums

/**
 * Every Postgres enum (database.types.ts, generated from supabase/migrations) and the @leaseguard/domain
 * tuple that must hold exactly the same values in the same order (Postgres enum order is the sort order).
 */
const PAIRS: { readonly [E in DbEnumName]: readonly string[] } = {
  approval_decision: domain.APPROVAL_DECISIONS,
  arrangement_status: domain.ARRANGEMENT_STATUSES,
  audit_action: domain.AUDIT_ACTIONS,
  business_type: domain.BUSINESS_TYPES,
  channel: domain.CHANNELS,
  company_status: domain.COMPANY_STATUSES,
  delivery_status: domain.DELIVERY_STATUSES,
  deposit_holder: domain.DEPOSIT_HOLDERS,
  entity_type: domain.ENTITY_TYPES,
  escalation_frequency: domain.ESCALATION_FREQUENCIES,
  escalation_type: domain.ESCALATION_TYPES,
  event_priority: domain.EVENT_PRIORITIES,
  extraction_field_name: domain.EXTRACTION_FIELD_NAMES,
  extraction_status: domain.EXTRACTION_STATUSES,
  guarantee_status: domain.GUARANTEE_STATUSES,
  installment_frequency: domain.INSTALLMENT_FREQUENCIES,
  installment_status: domain.INSTALLMENT_STATUSES,
  lease_document_type: domain.LEASE_DOCUMENT_TYPES,
  lease_status: domain.LEASE_STATUSES,
  line_item_category: domain.LINE_ITEM_CATEGORIES,
  line_item_kind: domain.LINE_ITEM_KINDS,
  message_direction: domain.MESSAGE_DIRECTIONS,
  message_type: domain.MESSAGE_TYPES,
  monitoring_event_status: domain.MONITORING_EVENT_STATUSES,
  monitoring_event_type: domain.MONITORING_EVENT_TYPES,
  notification_severity: domain.NOTIFICATION_SEVERITIES,
  notification_type: domain.NOTIFICATION_TYPES,
  occupancy_status: domain.OCCUPANCY_STATUSES,
  property_status: domain.PROPERTY_STATUSES,
  property_type: domain.PROPERTY_TYPES,
  recipient_type: domain.RECIPIENT_TYPES,
  sa_province: domain.SA_PROVINCES,
  statement_source: domain.STATEMENT_SOURCES,
  statement_status: domain.STATEMENT_STATUSES,
  template_approval_status: domain.TEMPLATE_APPROVAL_STATUSES,
  tenant_status: domain.TENANT_STATUSES,
  unit_type: domain.UNIT_TYPES,
  user_role: domain.USER_ROLES,
  user_status: domain.USER_STATUSES,
  weekday: domain.WEEKDAYS,
  whatsapp_connection_status: domain.WHATSAPP_CONNECTION_STATUSES,
}

/**
 * Domain string tuples that deliberately have no Postgres enum. Adding a tuple to the domain fails this
 * test until it is paired above or listed here with the reason.
 */
const DOMAIN_ONLY: Readonly<Record<string, string>> = {
  INVITATION_STATUSES: 'company_invitations.status is text with a check constraint (20261109101900), not an enum',
  ONBOARDING_STEPS: 'computed by the onboarding endpoint; never stored',
  OWNER_MESSAGE_TYPES: 'subset of message_type (communication eligibility rule)',
  FORBIDDEN_TENANT_TOPICS: 'message content rule; never stored',
  REPORT_IDS: 'report catalogue; reports are computed, not stored',
  EXPIRY_BUCKETS: 'report grouping; computed',
  LEASE_EXPIRY_STATUSES: 'derived lease expiry state; computed',
  GUARANTEE_EXPIRY_STATES: 'derived guarantee state; computed',
  RENEWAL_DEADLINE_STATUSES: 'derived renewal notice state; computed',
  EXTRACTION_RESULT_STATUSES: 'document-processing service response contract; not stored as an enum',
  EXTRACTION_ISSUE_CODES: 'document-processing service response contract; not stored as an enum',
  EXTRACTION_ISSUE_SEVERITIES: 'document-processing service response contract; not stored as an enum',
  DOCUMENT_PROCESSING_ERROR_CODES: 'document-processing service error contract; not stored',
  FINANCIAL_EXTRACTION_FIELDS: 'subset of extraction_field_name (financial fields)',
  REQUIRED_ONBOARDING_STEPS: 'subset of ONBOARDING_STEPS; computed',
  MONITORED_LEASE_STATUSES: 'subset of lease_status (monitoring rule)',
  OPEN_EVENT_STATUSES: 'subset of monitoring_event_status (workflow rule)',
  TERMINAL_EVENT_STATUSES: 'subset of monitoring_event_status (workflow rule)',
}

/**
 * Domain tuples that a Postgres predicate function (not an enum) mirrors. The pgTAP test named here
 * checks the function against the list between its markers; this test reads the same lines and checks
 * them against the domain tuple, so SQL and TypeScript are held to one list.
 */
const PREDICATE_PAIRS: Readonly<Record<string, { tuple: readonly string[]; sqlFunction: string; pgtapFile: string; marker: string }>> = {
  TENANT_MESSAGE_TYPES: {
    tuple: domain.TENANT_MESSAGE_TYPES,
    sqlFunction: 'private.is_tenant_message_type',
    pgtapFile: 'tenant_message_rules.test.sql',
    marker: 'tenant-message-types',
  },
}

/** The values listed between `-- <marker>:begin` and `-- <marker>:end` of a pgTAP file, one `('value')` per line. */
function pgtapList(file: string, marker: string): string[] {
  const path = resolve(__dirname, '../../../../supabase/tests', file)
  const block = new RegExp(String.raw`-- ${marker}:begin\n([\s\S]*?)-- ${marker}:end`).exec(readFileSync(path, 'utf8'))?.[1]
  if (!block) throw new Error(`No ${marker} block in ${path}`)
  return [...block.matchAll(/^\s*\('([a-z_]+)'\)[,;]\s*$/gm)].map((match) => match[1]!)
}

/** Postgres enums with no domain tuple; each needs a reason. Empty: every enum is paired. */
const DATABASE_ONLY: Readonly<Record<string, string>> = {}

/** Exported domain constants that are non-empty arrays of strings (the enum-like tuples). */
function domainTuples(): Map<string, readonly string[]> {
  const tuples = new Map<string, readonly string[]>()
  for (const [name, value] of Object.entries(domain)) {
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) tuples.set(name, value)
  }
  return tuples
}

describe('Postgres enums and @leaseguard/domain tuples', () => {
  const dbEnums: Readonly<Record<string, readonly string[]>> = Constants.public.Enums

  it.each(Object.keys(PAIRS) as DbEnumName[])('%s holds the same values in the same order as its domain tuple', (name) => {
    expect([...dbEnums[name]!]).toEqual([...PAIRS[name]])
  })

  it('pairs every Postgres enum or lists it as database-only', () => {
    const unpaired = Object.keys(dbEnums).filter((name) => !(name in PAIRS) && !(name in DATABASE_ONLY))
    expect(unpaired).toEqual([])
    expect(Object.keys(DATABASE_ONLY).filter((name) => !(name in dbEnums))).toEqual([])
  })

  it('pairs every domain tuple or lists it as domain-only, with no stale allowlist entries', () => {
    const tuples = domainTuples()
    const paired = new Set<readonly string[]>([...Object.values(PAIRS), ...Object.values(PREDICATE_PAIRS).map((pair) => pair.tuple)])
    const unpaired = [...tuples].filter(([name, tuple]) => !paired.has(tuple) && !(name in DOMAIN_ONLY)).map(([name]) => name)
    expect(unpaired).toEqual([])
    expect(Object.keys(DOMAIN_ONLY).filter((name) => !tuples.has(name))).toEqual([])
  })

  it.each(Object.entries(PREDICATE_PAIRS))('%s holds exactly the values the SQL predicate accepts (pgTAP list)', (_name, pair) => {
    const listed = pgtapList(pair.pgtapFile, pair.marker)
    expect(listed.length, `${pair.sqlFunction} parity list in ${pair.pgtapFile}`).toBeGreaterThan(0)
    expect([...listed].sort()).toEqual([...pair.tuple].sort())
  })
})
