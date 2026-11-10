import { z } from 'zod'

/** Events of Meta's `WA_EMBEDDED_SIGNUP` message (research §3.2). */
export const EMBEDDED_SIGNUP_EVENTS = [
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'FINISH_GRANT_ONLY_API_ACCESS',
  'CANCEL',
  'ERROR',
] as const
export type EmbeddedSignupEvent = (typeof EMBEDDED_SIGNUP_EVENTS)[number]

const metaId = z.string().regex(/^[0-9]{1,32}$/, 'a numeric Meta id')
const shortText = (max: number) => z.string().trim().max(max)

/**
 * The `data` of Meta's message, as the browser received it: v5 session info (`messaging_account_ids`) or the
 * v4 shape (`waba_id`), plus CANCEL (`current_step`) and ERROR (`error_*`) fields. Known fields are validated
 * strictly; other fields Meta adds (page_ids, catalog_ids, primary_waac_ids, …) are dropped, so a new
 * optional array from Meta does not break signup.
 */
export const embeddedSignupSessionInfoSchema = z.object({
  phone_number_id: metaId.optional(),
  waba_id: metaId.optional(),
  messaging_account_ids: z.array(metaId).max(20).optional(),
  business_id: metaId.optional(),
  is_on_biz_app: z.boolean().optional(),
  current_step: shortText(100).optional(),
  error_message: shortText(500).optional(),
  error_code: z.union([shortText(40), z.number().int()]).transform(String).optional(),
  session_id: shortText(200).optional(),
  timestamp: z.union([shortText(40), z.number()]).optional(),
})
export type EmbeddedSignupSessionInfo = z.infer<typeof embeddedSignupSessionInfoSchema>

/** Body of POST /integrations/whatsapp/onboarding-sessions/:sessionId/complete. */
export const completeOnboardingBodySchema = z
  .object({
    state: z.string().regex(/^[0-9a-f]{64}$/, 'the state returned when the session was started'),
    event: z.enum(EMBEDDED_SIGNUP_EVENTS),
    /** The one-time code from FB.login (only when the customer clicked Finish). Never logged or stored. */
    code: z.string().min(1).max(2048).regex(/^\S+$/, 'must not contain whitespace').optional(),
    sessionInfo: embeddedSignupSessionInfoSchema.optional(),
  })
  .strict()
export type CompleteOnboardingBody = z.infer<typeof completeOnboardingBodySchema>

/** POST .../numbers/:numberId/register: the 6-digit PIN Meta's register endpoint requires; never stored. */
export const registerNumberBodySchema = z.strictObject({
  pin: z.string().regex(/^[0-9]{6}$/, 'a 6-digit PIN'),
})
export type RegisterNumberBody = z.infer<typeof registerNumberBodySchema>
