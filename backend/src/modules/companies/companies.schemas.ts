import { SA_PROVINCES, WEEKDAYS } from '@leaseguard/domain'
import { z } from 'zod'

/** Optional text that can be cleared: '' or null clears it, omitted leaves it unchanged. */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()

const requiredText = (max: number) => z.string().trim().min(1).max(max)

/** Days before an event at which notices are raised: positive (database CHECK), distinct. */
const noticeDays = z
  .array(z.number().int().min(1).max(3650))
  .min(1)
  .max(10)
  .refine((days) => new Set(days).size === days.length, { message: 'must not repeat a day' })

/**
 * Body of PATCH /companies/:companyId: the company profile and monitoring settings a company_admin may
 * change (the columns the database grants them). Platform-managed fields (status, initials, timezone,
 * country) are not accepted. An address replaces the whole address.
 */
export const updateCompanyBodySchema = z
  .object({
    name: requiredText(200).optional(),
    tradingName: clearableText(200),
    registrationNumber: clearableText(50),
    vatNumber: clearableText(30),
    address: z
      .object({
        line1: requiredText(200),
        line2: clearableText(200),
        suburb: requiredText(100),
        city: requiredText(100),
        province: z.enum(SA_PROVINCES),
        postalCode: z.string().trim().regex(/^[0-9]{4}$/, 'must be a four-digit South African postal code'),
      })
      .strict()
      .optional(),
    contactEmail: z.string().trim().max(320).pipe(z.email('must be an email address')).optional(),
    contactPhone: requiredText(30).optional(),
    settings: z
      .object({
        leaseExpiryNoticeDays: noticeDays.optional(),
        renewalDeadlineWarningDays: noticeDays.optional(),
        guaranteeExpiryNoticeDays: noticeDays.optional(),
        paymentReminderOffsetsDays: z
          .object({
            initial: z.number().int().min(0).max(365),
            overdue: z.number().int().min(0).max(365),
            followUp: z.number().int().min(0).max(365),
          })
          .strict()
          .refine((offsets) => offsets.initial < offsets.overdue && offsets.overdue < offsets.followUp, {
            message: 'reminder offsets must increase: initial < overdue < followUp',
          })
          .optional(),
        installmentReminderLeadDays: z.number().int().min(0).max(60).optional(),
        ownerSummaryWeekday: z.enum(WEEKDAYS).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    ({ settings, ...profile }) =>
      Object.values(profile).some((value) => value !== undefined) ||
      (settings !== undefined && Object.values(settings).some((value) => value !== undefined)),
    { message: 'Provide at least one field to change' },
  )
export type UpdateCompanyBody = z.infer<typeof updateCompanyBodySchema>

/** Body of PUT /companies/:companyId/whatsapp: the Meta identifiers and display fields. */
export const configureWhatsAppBodySchema = z
  .object({
    businessAccountId: z.string().trim().regex(/^[0-9]{5,32}$/, 'must be the numeric WhatsApp Business Account id'),
    phoneNumberId: z.string().trim().regex(/^[0-9]{5,32}$/, 'must be the numeric phone number id'),
    displayName: requiredText(100),
    displayNumber: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9 ]{6,24}$/, 'must be an international number such as +27 11 555 0100'),
  })
  .strict()
export type ConfigureWhatsAppBody = z.infer<typeof configureWhatsAppBodySchema>
