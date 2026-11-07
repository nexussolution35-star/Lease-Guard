import { isTenantMessageType } from '@leaseguard/domain'
import { checkMessageContent, fillPlaceholders, templatePlaceholders, type MessageContentCheck } from '@leaseguard/domain'
import type { EntityId, MessageTemplate, RecipientType, TemplateApprovalStatus } from '@leaseguard/domain'

import { templatesRepo } from '@/services/communications'
import type { CreateInput, UpdateInput } from '@/services/repository'

/**
 * Message template service. Read functions (`listTemplates`, `getTemplate`, `listTenantTemplates`,
 * hooks) live in communications.ts and are reused; this module adds validated writes and rendering.
 */

export type TemplateValidation = MessageContentCheck

/**
 * Validate a template/message body for its audience (rules in `@/domain/messageContent`):
 * no banking details ever; no forbidden topics for tenants; contiguous {{1}}…{{n}} placeholders.
 */
export function validateTemplateBody(body: string, audience: RecipientType): TemplateValidation {
  return checkMessageContent(body, audience)
}

export class TemplateValidationError extends Error {
  readonly errors: readonly string[]
  constructor(errors: readonly string[]) {
    super(errors.join('; '))
    this.name = 'TemplateValidationError'
    this.errors = errors
  }
}

function validateTemplate(t: Pick<MessageTemplate, 'body' | 'audience' | 'messageType' | 'variables'>): string[] {
  const errors = [...validateTemplateBody(t.body, t.audience).errors]
  if (t.audience === 'tenant' && !isTenantMessageType(t.messageType)) {
    errors.push(`Message type "${t.messageType}" may not be used for tenant templates`)
  }
  if (t.audience === 'property_owner' && isTenantMessageType(t.messageType)) {
    errors.push(`Message type "${t.messageType}" is a tenant message type`)
  }
  const placeholders = templatePlaceholders(t.body)
  if (placeholders.length !== t.variables.length) {
    errors.push(`Template has ${placeholders.length} placeholder(s) but ${t.variables.length} variable name(s)`)
  }
  return errors
}

export type CreateTemplateInput = Omit<CreateInput<MessageTemplate>, 'approvalStatus'> & {
  approvalStatus?: TemplateApprovalStatus
}

/** Create a template after validation. New templates start as `draft` unless stated. */
export function createMessageTemplate(input: CreateTemplateInput): MessageTemplate {
  const errors = validateTemplate(input)
  if (errors.length > 0) throw new TemplateValidationError(errors)
  return templatesRepo.create({ ...input, approvalStatus: input.approvalStatus ?? 'draft' }, { summary: `Template "${input.name}" created` })
}

/**
 * Update a template after validating the merged result. Editing the body of an approved template
 * returns it to `draft` (it must be re-approved by Meta before use).
 */
export function updateMessageTemplate(id: EntityId, patch: UpdateInput<MessageTemplate>): MessageTemplate {
  const before = templatesRepo.require(id)
  const merged = { ...before, ...patch }
  const errors = validateTemplate(merged)
  if (errors.length > 0) throw new TemplateValidationError(errors)
  const bodyChanged = patch.body !== undefined && patch.body !== before.body
  const approvalStatus = bodyChanged && patch.approvalStatus === undefined ? 'draft' : merged.approvalStatus
  return templatesRepo.update(id, { ...patch, approvalStatus }, { summary: `Template "${merged.name}" updated` })
}

export function deleteMessageTemplate(id: EntityId): void {
  const t = templatesRepo.require(id)
  templatesRepo.remove(id, { summary: `Template "${t.name}" deleted` })
}

/** Simulated Meta submission: draft/rejected → submitted. */
export function submitTemplateForApproval(id: EntityId): MessageTemplate {
  const t = templatesRepo.require(id)
  if (t.approvalStatus !== 'draft' && t.approvalStatus !== 'rejected') {
    throw new Error(`Template "${t.name}" is ${t.approvalStatus} and cannot be submitted`)
  }
  return templatesRepo.update(id, { approvalStatus: 'submitted' }, { summary: `Template "${t.name}" submitted to Meta` })
}

/** Simulated Meta decision: submitted → approved / rejected. */
export function recordTemplateDecision(id: EntityId, decision: Extract<TemplateApprovalStatus, 'approved' | 'rejected'>): MessageTemplate {
  const t = templatesRepo.require(id)
  if (t.approvalStatus !== 'submitted') throw new Error(`Template "${t.name}" has not been submitted`)
  return templatesRepo.update(
    id,
    { approvalStatus: decision },
    { action: decision === 'approved' ? 'approve' : 'reject', summary: `Template "${t.name}" ${decision} by Meta` },
  )
}

/**
 * Fill a template's `{{n}}` placeholders. `variables` may be keyed by placeholder number (`'1'`)
 * or by the template's variable name (`'tenant first name'`). Throws when any placeholder has no
 * value. The rendered text is re-validated so a variable can never smuggle in banking details or
 * (for tenants) a forbidden topic.
 */
export function renderTemplate(
  template: Pick<MessageTemplate, 'body' | 'variables' | 'audience'>,
  variables: Record<string, string>,
): string {
  const values: Record<number, string | undefined> = {}
  for (const n of templatePlaceholders(template.body)) {
    values[n] = variables[String(n)] ?? variables[template.variables[n - 1] ?? '']
  }
  const rendered = fillPlaceholders(template.body, values)
  const check = checkMessageContent(rendered, template.audience)
  if (!check.valid) throw new TemplateValidationError(check.errors)
  return rendered
}
