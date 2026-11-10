import { z } from 'zod'

/** E.164 without spaces, as the profiles CHECK requires (e.g. +27821234567). */
const E164 = /^\+[1-9][0-9]{7,14}$/

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional()

/** Fields a signed-in user may change on their own profile (the columns RLS grants them). */
export const updateMeBodySchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: optionalText(30),
    whatsappNumber: z
      .string()
      .trim()
      .transform((value) => (value === '' ? null : value.replace(/\s+/g, '')))
      .pipe(z.string().regex(E164, 'must be an international number such as +27821234567').nullable())
      .nullable()
      .optional(),
    jobTitle: optionalText(100),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'Provide at least one field to change' })
export type UpdateMeBody = z.infer<typeof updateMeBodySchema>
