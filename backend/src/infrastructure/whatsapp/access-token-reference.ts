/**
 * The one place in TypeScript that knows the `whatsapp_phone_numbers.access_token_reference` formats. The
 * database enforces the same rule (`private.is_whatsapp_token_reference`, migration
 * 20261110100000); access-token-reference.test.ts checks both against the case table in
 * supabase/tests/whatsapp_channel.test.sql.
 *
 * - `secret://env/WHATSAPP_ACCESS_TOKEN_<company uuid without dashes, uppercase>`: a worker environment
 *   variable. Bound to the row's own company, so a reference can never name another company's token or
 *   another worker secret (such as the service-role key).
 * - `secret://vault/<vault secret uuid, lowercase>`: a Supabase Vault secret. The database binds the
 *   secret to the company by its name, so the shape alone is enough here.
 *
 * Internal to the WhatsApp channel module, except `WHATSAPP_ACCESS_TOKEN_KEY` (config/env.ts).
 */

import type { EntityId } from '@leaseguard/domain'

const ENV_REFERENCE_PREFIX = 'secret://env/'
const VAULT_REFERENCE_PREFIX = 'secret://vault/'
const ENV_VARIABLE_PREFIX = 'WHATSAPP_ACCESS_TOKEN_'
const COMPANY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Lowercase only: Postgres prints uuids in lowercase, and the SQL rule compares text.
const VAULT_SECRET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Names of the per-company token variables the worker loads from the root .env. The names depend on
 * data, so config/env.ts matches them by this pattern.
 */
export const WHATSAPP_ACCESS_TOKEN_KEY = new RegExp(`^${ENV_VARIABLE_PREFIX}[0-9A-F]{32}$`)

export type AccessTokenReference = { kind: 'env'; variable: string } | { kind: 'vault'; secretId: string }

/**
 * Company `companyId`'s token variable, e.g. `WHATSAPP_ACCESS_TOKEN_3AB0FC4AEADB50B8BC4D5673ADA1519E`
 * for company 3ab0fc4a-eadb-50b8-bc4d-5673ada1519e; null when the id is not a uuid.
 */
export function envAccessTokenVariable(companyId: EntityId): string | null {
  if (!COMPANY_UUID.test(companyId)) return null
  return `${ENV_VARIABLE_PREFIX}${companyId.replaceAll('-', '').toUpperCase()}`
}

/** The reference as stored for `companyId`, or null when the database would refuse it. */
export function parseAccessTokenReference(reference: string, companyId: EntityId): AccessTokenReference | null {
  if (reference.startsWith(ENV_REFERENCE_PREFIX)) {
    const variable = envAccessTokenVariable(companyId)
    return variable !== null && reference === `${ENV_REFERENCE_PREFIX}${variable}` ? { kind: 'env', variable } : null
  }
  if (reference.startsWith(VAULT_REFERENCE_PREFIX)) {
    const secretId = reference.slice(VAULT_REFERENCE_PREFIX.length)
    return VAULT_SECRET_ID.test(secretId) ? { kind: 'vault', secretId } : null
  }
  return null
}
