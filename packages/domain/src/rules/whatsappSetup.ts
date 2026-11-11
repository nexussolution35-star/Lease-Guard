import {
  WHATSAPP_SETUP_STEPS,
  type WhatsAppActivation,
  type WhatsAppSetup,
  type WhatsAppSetupState,
  type WhatsAppSetupStep,
  type WhatsAppSetupStepStatus,
  type WhatsAppTestMessage,
} from '../types/index.js'

/** One step as the database computed it from verified facts (whatsapp_setup_status). */
export interface WhatsAppSetupRow {
  step: WhatsAppSetupStep
  required: boolean
  state: WhatsAppSetupState
}

type Guidance = { readonly title: string } & { readonly [S in WhatsAppSetupState]: string }

/** What each step means in each state, for a company admin. */
const GUIDANCE: { readonly [S in WhatsAppSetupStep]: Guidance } = {
  business_profile: {
    title: 'Business profile',
    done: 'The company name, address and contact details are filled in.',
    action_needed: 'Complete the company profile: name, address, contact email and phone.',
    waiting_on_meta: 'Complete the company profile: name, address, contact email and phone.',
    blocked: 'Complete the company profile: name, address, contact email and phone.',
  },
  meta_account: {
    title: 'Meta account connected',
    done: 'LeaseGuard holds verified access to your WhatsApp Business through Meta.',
    action_needed: 'Click Connect WhatsApp Business and finish Meta’s signup window.',
    waiting_on_meta: 'A WhatsApp signup is in progress. Finish it in Meta’s window, or start again if you closed it.',
    blocked: 'Click Connect WhatsApp Business and finish Meta’s signup window.',
  },
  business_account: {
    title: 'WhatsApp Business Account connected',
    done: 'Meta confirmed LeaseGuard’s access covers your WhatsApp Business Account.',
    action_needed: 'Meta did not confirm access to the account. Open the number’s checks below, follow “How to fix” and verify again.',
    waiting_on_meta: 'LeaseGuard is checking the account with Meta.',
    blocked: 'Connect your Meta account first.',
  },
  phone_number: {
    title: 'Phone number verified',
    done: 'Meta lists the number in your account and it is registered for WhatsApp.',
    action_needed: 'Finish the number’s checks below: register it with its PIN, or follow “How to fix” and verify again.',
    waiting_on_meta: 'LeaseGuard is verifying the number with Meta.',
    blocked: 'Connect your WhatsApp Business Account first.',
  },
  webhook: {
    title: 'Webhook connected',
    done: 'Meta sends this account’s messages and delivery updates to LeaseGuard.',
    action_needed: 'Meta did not accept LeaseGuard’s webhook subscription. Verify the number again.',
    waiting_on_meta: 'LeaseGuard is subscribing to the account’s messages at Meta.',
    blocked: 'Connect your WhatsApp Business Account first.',
  },
  message_templates: {
    title: 'Message templates ready',
    done: 'Meta approved at least one utility template.',
    action_needed: 'Create a utility message template in WhatsApp Manager and submit it to Meta for review, then verify the number again.',
    waiting_on_meta: 'Meta is reviewing your templates. This step completes once Meta approves a utility template.',
    blocked: 'Connect your WhatsApp Business Account first.',
  },
  ai_agent: {
    title: 'AI agent configured',
    done: 'The AI agent is set up. Tenants are never answered automatically.',
    action_needed: 'Recommended: set up the AI agent that answers contacts’ common questions.',
    waiting_on_meta: 'Recommended: set up the AI agent that answers contacts’ common questions.',
    blocked: 'Recommended: set up the AI agent that answers contacts’ common questions.',
  },
  knowledge_base: {
    title: 'Knowledge base configured',
    done: 'At least one FAQ, entry or document is approved for the AI agent.',
    action_needed: 'Recommended: add and approve FAQs or knowledge entries. Only approved items reach the AI agent.',
    waiting_on_meta: 'Recommended: add and approve FAQs or knowledge entries. Only approved items reach the AI agent.',
    blocked: 'Recommended: add and approve FAQs or knowledge entries. Only approved items reach the AI agent.',
  },
  test_message: {
    title: 'Test message successful',
    done: 'Meta reported a test message from a connected number as delivered.',
    action_needed: 'Send a test message from an approved template to your own WhatsApp number.',
    waiting_on_meta: 'The test message is on its way. This step completes only when Meta reports it delivered.',
    blocked: 'Connect a number and get a template approved first.',
  },
  ready_for_activation: {
    title: 'Ready for activation',
    done: 'Every required step is verified. A company admin can activate WhatsApp.',
    action_needed: 'Finish the required steps above first.',
    waiting_on_meta: 'Finish the required steps above first.',
    blocked: 'Finish the required steps above first.',
  },
}

const ORDER = new Map<WhatsAppSetupStep, number>(WHATSAPP_SETUP_STEPS.map((step, index) => [step, index]))

/**
 * The company's WhatsApp setup for the web app: the steps in order with their title and guidance, how many are done,
 * and whether it may be activated. Readiness is the database's verdict (its ready_for_activation step), never
 * recomputed here, so the page and the activation guard cannot disagree.
 */
export function whatsAppSetup(
  rows: readonly WhatsAppSetupRow[],
  activation: WhatsAppActivation,
  latestTestMessage?: WhatsAppTestMessage,
): WhatsAppSetup {
  const steps: WhatsAppSetupStepStatus[] = [...rows]
    .map((row) => {
      const guidance = GUIDANCE[row.step] as Guidance | undefined
      if (!guidance) throw new Error(`Unknown WhatsApp setup step "${row.step}"`)
      return { step: row.step, required: row.required, state: row.state, title: guidance.title, guidance: guidance[row.state] }
    })
    .sort((a, b) => (ORDER.get(a.step) ?? 0) - (ORDER.get(b.step) ?? 0))
  return {
    steps,
    completedSteps: steps.filter((s) => s.state === 'done').length,
    totalSteps: WHATSAPP_SETUP_STEPS.length,
    readyForActivation: steps.some((s) => s.step === 'ready_for_activation' && s.state === 'done'),
    activation,
    ...(latestTestMessage ? { latestTestMessage } : {}),
  }
}

const E164 = /^\+[1-9][0-9]{7,14}$/

/** A test message recipient: a WhatsApp number in international (E.164) format, e.g. +27821234567. */
export function isWhatsAppTestRecipient(number: string): boolean {
  return E164.test(number)
}
