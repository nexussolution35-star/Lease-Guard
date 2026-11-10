import {
  AGENT_LANGUAGES,
  AGENT_PERMITTED_ACTIONS,
  type AgentLanguage,
  type AgentPermittedAction,
  isClockTime,
  operatingHoursProblems,
  WEEKDAYS,
  type WhatsAppAgentConfig,
  type WhatsAppAgentConfigInput,
} from '@leaseguard/domain'
import { z } from 'zod'

/** Labels for the agent's languages (South African official languages). */
export const LANGUAGE_LABELS: Readonly<Record<AgentLanguage, string>> = {
  en: 'English',
  af: 'Afrikaans',
  zu: 'isiZulu',
  xh: 'isiXhosa',
  st: 'Sesotho',
  tn: 'Setswana',
  nso: 'Sepedi',
  ts: 'Xitsonga',
  ss: 'siSwati',
  ve: 'Tshivenda',
  nr: 'isiNdebele',
}

/** What each permitted action lets the agent do, for the settings form. */
export const ACTION_TEXT: Readonly<Record<AgentPermittedAction, { label: string; description: string }>> = {
  answer_faq: { label: 'Answer frequently asked questions', description: 'Reply to contacts with your approved FAQs.' },
  share_business_info: {
    label: 'Share business information',
    description: 'Reply with your business description, operating hours and approved knowledge entries.',
  },
  share_approved_document: { label: 'Refer to approved documents', description: 'Point contacts to an approved document, such as a brochure.' },
  capture_enquiry: { label: 'Take down enquiries', description: 'Record what the contact needs so a person can follow up.' },
  draft_tenant_reply: {
    label: 'Suggest replies to tenants for staff',
    description: 'Draft an internal suggestion your staff can use when a tenant writes. It is never sent to the tenant.',
  },
}

export const DAY_LABELS: Readonly<Record<(typeof WEEKDAYS)[number], string>> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`)

export const agentFormSchema = z.object({
  agentName: z.string().trim().min(1, 'Give the agent a name').max(80, 'At most 80 characters'),
  businessDescription: text(4000),
  tone: text(500),
  timezone: z.string().min(1),
  operatingHours: z
    .array(
      z.object({
        day: z.enum(WEEKDAYS),
        opens: z.string().refine((value) => isClockTime(value), 'Use a 24-hour time such as 08:00'),
        closes: z.string().refine((value) => isClockTime(value, { closing: true }), 'Use a 24-hour time such as 17:00'),
      }),
    )
    .superRefine((periods, ctx) => {
      for (const problem of operatingHoursProblems(periods)) ctx.addIssue({ code: 'custom', message: problem })
    }),
  languages: z.array(z.enum(AGENT_LANGUAGES)).min(1, 'Choose at least one language'),
  policies: text(8000),
  supportInstructions: text(8000),
  escalationRules: text(8000),
  permittedActions: z.array(z.enum(AGENT_PERMITTED_ACTIONS)),
  autoReplyEnabled: z.boolean(),
  outOfHoursMessage: text(1000),
  handoverContactUserIds: z.array(z.string()).max(20, 'At most 20 handover contacts'),
})

export type AgentFormInput = z.input<typeof agentFormSchema>
export type AgentFormValues = z.output<typeof agentFormSchema>

/** The form's starting values from the saved (or default) configuration. */
export function agentFormDefaults(config: WhatsAppAgentConfig): AgentFormInput {
  return {
    agentName: config.agentName,
    businessDescription: config.businessDescription,
    tone: config.tone,
    timezone: config.timezone,
    operatingHours: config.operatingHours.map((period) => ({ ...period })),
    languages: [...config.languages],
    policies: config.policies,
    supportInstructions: config.supportInstructions,
    escalationRules: config.escalationRules,
    permittedActions: [...config.permittedActions],
    autoReplyEnabled: config.autoReplyEnabled,
    outOfHoursMessage: config.outOfHoursMessage ?? '',
    handoverContactUserIds: config.handoverContacts.map((contact) => contact.userId),
  }
}

/** The form's values → what the API saves (an empty out-of-hours message is none). */
export function agentConfigInput(values: AgentFormValues): WhatsAppAgentConfigInput {
  const { outOfHoursMessage, ...rest } = values
  return { ...rest, ...(outOfHoursMessage ? { outOfHoursMessage } : {}) }
}
