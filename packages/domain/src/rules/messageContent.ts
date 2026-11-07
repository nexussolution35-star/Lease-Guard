import type { RecipientType } from '../types/index.js'
import { FORBIDDEN_TENANT_TOPICS, type ForbiddenTenantTopic } from './communicationEligibility.js'

/**
 * Pure message-content rules. LeaseGuard never collects or facilitates payments, so outbound
 * messages must never carry banking details; tenant messages must also stay off forbidden topics.
 */

export type BankDetailKind = 'bank_keyword' | 'account_number' | 'iban'

export interface BankDetailMatch {
  kind: BankDetailKind
  /** The offending text as it appears in the message. */
  text: string
}

const BANK_KEYWORDS: readonly RegExp[] = [
  /\baccount\s*(?:number|no\.?|#)/i,
  /\bacc(?:ount)?\s*no\b/i,
  /\bbranch\s*code\b/i,
  /\bbank(?:ing)?\s*details\b/i,
  /\bswift\s*(?:code|bic)\b/i,
  /\biban\b/i,
]

/** IBAN-like: 2 letters, 2 check digits, 11–30 alphanumerics (spaces allowed in groups of 4). */
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g

/**
 * A run of 9–17 consecutive digits not prefixed by `+` (international phone numbers) and not part of
 * a longer digit run. SA bank account numbers are 9–11 digits; 10-digit SA phone numbers
 * (`0[1-8]xxxxxxxx`) are deliberately NOT flagged so a contact number never trips the rule.
 */
const DIGIT_RUN_PATTERN = /(?<![+\d])\d{9,17}(?!\d)/g
const SA_PHONE_PATTERN = /^0[1-8]\d{8}$/

/** Every banking-detail fragment in `text` (empty when clean). */
export function findBankDetails(text: string): BankDetailMatch[] {
  const matches: BankDetailMatch[] = []
  for (const re of BANK_KEYWORDS) {
    const m = re.exec(text)
    if (m) matches.push({ kind: 'bank_keyword', text: m[0] })
  }
  for (const m of text.matchAll(IBAN_PATTERN)) {
    if (/\d{6,}/.test(m[0].replace(/\s/g, ''))) matches.push({ kind: 'iban', text: m[0] })
  }
  for (const m of text.matchAll(DIGIT_RUN_PATTERN)) {
    if (!SA_PHONE_PATTERN.test(m[0])) matches.push({ kind: 'account_number', text: m[0] })
  }
  return matches
}

/** True when the message contains account numbers, branch codes, IBANs or banking-detail wording. */
export function containsBankDetails(text: string): boolean {
  return findBankDetails(text).length > 0
}

/** Keyword patterns per forbidden tenant topic (case-insensitive, word-bounded). */
export const FORBIDDEN_TOPIC_PATTERNS: Readonly<Record<ForbiddenTenantTopic, readonly RegExp[]>> = {
  rental_escalation: [/\bescalat(?:e|es|ed|ion|ions)\b/i, /\brent(?:al)?\s+increase/i],
  lease_expiry: [/\blease\s+(?:expiry|expires|expiring|expiration|end(?:s|ing)?)\b/i, /\bexpiry\s+of\s+(?:your|the)\s+lease\b/i],
  renewal_option: [/\brenew(?:al|als|ed|ing)?\b/i],
  dispute: [/\bdisput(?:e|es|ed)\b/i],
  bank_guarantee: [/\bguarantee(?:s|d)?\b/i],
  deposit: [/\bdeposit(?:s)?\b/i],
}

/** Forbidden tenant topics mentioned in `text`, in FORBIDDEN_TENANT_TOPICS order. */
export function findForbiddenTenantTopics(text: string): ForbiddenTenantTopic[] {
  return FORBIDDEN_TENANT_TOPICS.filter((topic) => FORBIDDEN_TOPIC_PATTERNS[topic].some((re) => re.test(text)))
}

// ---------------------------------------------------------------------------------- placeholders

const PLACEHOLDER_PATTERN = /\{\{\s*(\d+)\s*\}\}/g

/** Distinct `{{n}}` placeholder numbers in ascending order. */
export function templatePlaceholders(body: string): number[] {
  const set = new Set<number>()
  for (const m of body.matchAll(PLACEHOLDER_PATTERN)) set.add(Number(m[1]))
  return [...set].sort((a, b) => a - b)
}

export class MissingTemplateVariablesError extends Error {
  readonly missing: readonly number[]
  constructor(missing: readonly number[]) {
    super(`Missing template variable(s): ${missing.map((n) => `{{${n}}}`).join(', ')}`)
    this.name = 'MissingTemplateVariablesError'
    this.missing = missing
  }
}

/**
 * Replace every `{{n}}` with `values[n]`. Throws MissingTemplateVariablesError listing every
 * placeholder without a non-empty value; nothing is ever silently left blank.
 */
export function fillPlaceholders(body: string, values: Readonly<Record<number, string | undefined>>): string {
  const missing = templatePlaceholders(body).filter((n) => {
    const v = values[n]
    return v === undefined || v.trim() === ''
  })
  if (missing.length > 0) throw new MissingTemplateVariablesError(missing)
  return body.replace(PLACEHOLDER_PATTERN, (_m, n: string) => values[Number(n)] as string)
}

export interface MessageContentCheck {
  valid: boolean
  errors: string[]
  bankDetails: BankDetailMatch[]
  forbiddenTopics: ForbiddenTenantTopic[]
}

/**
 * Validate a message or template body for an audience. Rules:
 * - non-empty
 * - no banking details for any audience
 * - tenant audience: none of the forbidden tenant topics
 * - placeholders numbered contiguously from {{1}}
 */
export function checkMessageContent(body: string, audience: RecipientType): MessageContentCheck {
  const errors: string[] = []
  if (body.trim() === '') errors.push('Message body is empty')
  const bankDetails = findBankDetails(body)
  if (bankDetails.length > 0) {
    errors.push(
      `Messages may not contain banking details (LeaseGuard never collects payments): ${bankDetails.map((b) => `"${b.text}"`).join(', ')}`,
    )
  }
  const forbiddenTopics = audience === 'tenant' ? findForbiddenTenantTopics(body) : []
  if (forbiddenTopics.length > 0) {
    errors.push(`Tenant messages may not mention: ${forbiddenTopics.map((t) => t.replace(/_/g, ' ')).join(', ')}`)
  }
  const placeholders = templatePlaceholders(body)
  if (placeholders.some((n, i) => n !== i + 1)) {
    errors.push(`Placeholders must be numbered {{1}}…{{n}} without gaps (found ${placeholders.map((n) => `{{${n}}}`).join(', ')})`)
  }
  return { valid: errors.length === 0, errors, bankDetails, forbiddenTopics }
}
