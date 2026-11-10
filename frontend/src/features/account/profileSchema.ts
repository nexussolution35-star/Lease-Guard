import { z } from 'zod'

import { normaliseSAPhoneNumber } from '@/components/forms/phone'

import type { CurrentUserProfile, ProfileChanges } from './api/source'

/** E.164 without spaces, as the API and the profiles table require (e.g. +27821234567). */
const E164 = /^\+[1-9][0-9]{7,14}$/

export const WHATSAPP_NUMBER_ERROR = 'Enter an international number such as +27 82 123 4567'

/** A South African number in any common format, or any E.164 number; '' when left empty. */
const whatsappNumber = z
  .string()
  .trim()
  .transform((value) => (value === '' ? '' : (normaliseSAPhoneNumber(value) ?? value.replace(/[\s().-]/g, ''))))
  .refine((value) => value === '' || E164.test(value), { message: WHATSAPP_NUMBER_ERROR })

/** The "Edit profile" form: the fields a user may change on their own profile (see `PATCH /me`). */
export const profileFormSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your full name').max(120, 'Use at most 120 characters'),
  phone: z.string().trim().max(30, 'Use at most 30 characters'),
  whatsappNumber,
  jobTitle: z.string().trim().max(100, 'Use at most 100 characters'),
})

export type ProfileFormInput = z.input<typeof profileFormSchema>
export type ProfileFormValues = z.output<typeof profileFormSchema>

/** Form values for a profile; optional fields the user has not set are empty. */
export function profileFormDefaults(profile: Pick<CurrentUserProfile, 'fullName' | 'phone' | 'whatsappNumber' | 'jobTitle'>): ProfileFormInput {
  return {
    fullName: profile.fullName,
    phone: profile.phone ?? '',
    whatsappNumber: profile.whatsappNumber ?? '',
    jobTitle: profile.jobTitle ?? '',
  }
}

/** The `PATCH /me` body: every field, with an emptied optional field sent as null (clears it). */
export function profileChangesFrom(values: ProfileFormValues): ProfileChanges {
  const orNull = (value: string) => (value === '' ? null : value)
  return {
    fullName: values.fullName,
    phone: orNull(values.phone),
    whatsappNumber: orNull(values.whatsappNumber),
    jobTitle: orNull(values.jobTitle),
  }
}
