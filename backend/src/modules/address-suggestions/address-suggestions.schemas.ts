import { z } from 'zod'

/** A Google session token: URL- and filename-safe base64 (a UUID qualifies), one per lookup. */
const sessionToken = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'must be a URL-safe session token (e.g. a UUID)')

/** POST /address-suggestions: the text typed so far. */
export const addressSearchBodySchema = z.strictObject({
  input: z
    .string()
    .trim()
    .min(3, 'must be at least 3 characters')
    .max(200, 'must be at most 200 characters'),
  sessionToken,
})
export type AddressSearchBody = z.infer<typeof addressSearchBodySchema>

/** POST /address-suggestions/resolve: the chosen suggestion, with the same session token. */
export const addressResolveBodySchema = z.strictObject({
  placeId: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/, 'must be a Google place id'),
  sessionToken,
})
export type AddressResolveBody = z.infer<typeof addressResolveBodySchema>
