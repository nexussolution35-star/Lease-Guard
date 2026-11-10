#!/usr/bin/env node
// Nexus platform operator tooling: creates a client company and invites its first company_admin.
//
//   pnpm platform:create-company -- --name "Acme Properties" --initials AP \
//     --admin-email thandi@acme.co.za --admin-name "Thandi Nkosi" --province Gauteng --postal-code 2196
//
// Required: --name, --initials (2 letters), --admin-email, --admin-name, --province (one of the nine
// South African provinces) and --postal-code (4 digits); the database requires the last two. On a
// terminal, missing required values are prompted for; otherwise the script fails and lists them.
// Optional company profile fields (the admin completes them during onboarding): --trading-name,
// --address-line1, --suburb, --city, --contact-email, --contact-phone.
// Other options:
//   --redirect-url <url>  where the invitation link lands (default: WEB_APP_URL + '/auth/accept'; it
//                         must be in the Supabase Auth redirect allow-list); '?invitation=<id>' is added
//   --existing            the company already exists (same initials): only (re)send the admin invitation
//   --hosted              allow a hosted Supabase project (asks for confirmation on a terminal)
//   --yes                 with --hosted and no terminal: proceed without asking
//
// It uses the service role (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, and WEB_APP_URL for the default
// redirect) from the process environment, falling back to the repository-root .env (only those keys are
// read). Keys are never printed. The steps match the worker's 'user-invitations' processor: the
// company_invitations row (invited_by_user_id NULL = operator), then the invitee is looked up in Supabase
// Auth by email: a new or unconfirmed user gets the invitation email (inviteUserByEmail), a confirmed user
// gets none and accepts in the app. The status becomes 'sent'. NO membership is created: the company has
// no admin until the invitee accepts the invitation signed in with the invited email. Re-running is safe:
// an existing company is refused unless --existing, and an open invitation is reused (sent again while
// the user has not confirmed their email).

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, parseEnv } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ENV_FILE = resolve(ROOT, '.env')
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WEB_APP_URL']
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal'])
const ACCEPT_PATH = '/auth/accept'
const ADMIN_ROLE = 'company_admin'
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const USER_EXISTS_CODES = new Set(['email_exists', 'user_already_exists'])

class UsageError extends Error {}

function fail(message) {
  console.error(`platform:create-company: ${message}`)
  process.exit(1)
}

// --------------------------------------------------------------------------- inputs

const OPTIONS = {
  name: { type: 'string' },
  initials: { type: 'string' },
  'admin-email': { type: 'string' },
  'admin-name': { type: 'string' },
  'trading-name': { type: 'string' },
  'address-line1': { type: 'string' },
  suburb: { type: 'string' },
  city: { type: 'string' },
  province: { type: 'string' },
  'postal-code': { type: 'string' },
  'contact-email': { type: 'string' },
  'contact-phone': { type: 'string' },
  'redirect-url': { type: 'string' },
  existing: { type: 'boolean', default: false },
  hosted: { type: 'boolean', default: false },
  yes: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
}
const REQUIRED = ['name', 'initials', 'admin-email', 'admin-name', 'province', 'postal-code']

/** South African provinces, from @leaseguard/domain (its compiled output). */
async function loadProvinces() {
  const domainDist = resolve(ROOT, 'packages/domain/dist/index.js')
  if (!existsSync(domainDist)) fail('packages/domain is not built; run `pnpm --filter @leaseguard/domain build` first')
  const { SA_PROVINCES } = await import(pathToFileURL(domainDist).href)
  return SA_PROVINCES
}

/** Validates and normalises the inputs; throws UsageError listing every problem. */
export function validateInputs(values, provinces) {
  const problems = []
  const text = (key) => (values[key] ?? '').trim()
  const name = text('name')
  if (!name || name.length > 200) problems.push('--name: 1 to 200 characters')
  const initials = text('initials').toUpperCase()
  if (!/^[A-Z]{2}$/.test(initials)) problems.push('--initials: exactly 2 letters (A-Z)')
  const adminEmail = text('admin-email').toLowerCase()
  if (!EMAIL_SHAPE.test(adminEmail) || adminEmail.length > 320) problems.push('--admin-email: a valid email address')
  const adminName = text('admin-name')
  if (!adminName || adminName.length > 200) problems.push('--admin-name: 1 to 200 characters')
  const province = provinces.find((p) => p.toLowerCase() === text('province').toLowerCase())
  if (!province) problems.push(`--province: one of ${provinces.join(', ')}`)
  const postalCode = text('postal-code')
  if (!/^[0-9]{4}$/.test(postalCode)) problems.push('--postal-code: 4 digits')
  const contactEmail = text('contact-email').toLowerCase()
  if (contactEmail && !EMAIL_SHAPE.test(contactEmail)) problems.push('--contact-email: a valid email address')
  const contactPhone = text('contact-phone')
  if (contactPhone && !/^\+?[0-9 ()-]{7,20}$/.test(contactPhone)) problems.push('--contact-phone: a phone number such as +27 11 555 0100')
  if (problems.length) throw new UsageError(`invalid input:\n  ${problems.join('\n  ')}`)
  return {
    company: {
      name,
      trading_name: text('trading-name') || null,
      initials,
      address_line1: text('address-line1'),
      suburb: text('suburb'),
      city: text('city'),
      province,
      postal_code: postalCode,
      contact_email: contactEmail,
      contact_phone: contactPhone,
    },
    admin: { email: adminEmail, fullName: adminName },
  }
}

/** True for anything that is not the local Supabase CLI stack. */
export function isHostedUrl(url) {
  return !LOCAL_HOSTS.has(new URL(url).hostname)
}

/** The invitation redirect base: --redirect-url, else WEB_APP_URL + /auth/accept. */
export function redirectUrlFor(explicit, webAppUrl, hosted) {
  const raw = explicit?.trim() || (webAppUrl?.trim() ? `${webAppUrl.trim().replace(/\/+$/, '')}${ACCEPT_PATH}` : '')
  if (!raw) throw new UsageError('set WEB_APP_URL (see .env.example) or pass --redirect-url')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new UsageError(`--redirect-url / WEB_APP_URL is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UsageError('the redirect URL must be http(s)')
  if (hosted && url.protocol !== 'https:') throw new UsageError('a hosted project needs an https redirect URL')
  return url.toString()
}

/** The link for one invitation: the redirect base with ?invitation=<id> (the accept page reads it). */
export function invitationRedirect(base, invitationId) {
  const url = new URL(base)
  url.searchParams.set('invitation', invitationId)
  return url.toString()
}

async function promptMissing(values, rl) {
  for (const key of REQUIRED) {
    if (values[key]?.trim()) continue
    values[key] = (await rl.question(`${key}: `)).trim()
  }
}

// --------------------------------------------------------------------------- database steps

function unwrap({ data, error }, operation) {
  if (error) throw new Error(`${operation} failed (${error.code}): ${error.message}`)
  return data
}

async function findCompany(db, company) {
  const byInitials = unwrap(await db.from('companies').select('id, name, initials').eq('initials', company.initials), 'Look up company by initials')
  const byName = unwrap(await db.from('companies').select('id, name, initials').ilike('name', company.name.replace(/[%_\\]/g, '\\$&')), 'Look up company by name')
  const seen = new Map([...byInitials, ...byName].map((row) => [row.id, row]))
  return [...seen.values()]
}

/** The open (or accepted) admin invitation for this email, or a new pending one. */
async function adminInvitation(db, companyId, admin) {
  const rows = unwrap(
    await db
      .from('company_invitations')
      .select('id, status, email, full_name, role, invited_user_id')
      .eq('company_id', companyId)
      .eq('email', admin.email)
      .in('status', ['pending', 'sent', 'accepted', 'failed'])
      .order('created_at', { ascending: false }),
    'Look up invitations',
  )
  const open = rows.find((row) => row.status === 'pending' || row.status === 'sent') ?? rows.find((row) => row.status === 'accepted')
  if (open) return open
  const failed = rows.find((row) => row.status === 'failed')
  if (failed) {
    const [reopened] = unwrap(
      await db
        .from('company_invitations')
        .update({ status: 'pending', failure_reason: null })
        .eq('company_id', companyId)
        .eq('id', failed.id)
        .eq('status', 'failed')
        .select('id, status, email, full_name, role, invited_user_id'),
      'Reopen failed invitation',
    )
    if (reopened) return reopened
  }
  return unwrap(
    await db
      .from('company_invitations')
      .insert({ company_id: companyId, email: admin.email, full_name: admin.fullName, role: ADMIN_ROLE })
      .select('id, status, email, full_name, role, invited_user_id')
      .single(),
    'Create invitation',
  )
}

async function findAuthUserByEmail(authAdmin, email) {
  for (let page = 1; page <= 1000; page++) {
    const { data, error } = await authAdmin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`List auth users failed: ${error.message}`)
    const match = data.users.find((user) => user.email?.toLowerCase() === email)
    if (match) return match
    if (data.users.length < 1000) return null
  }
  return null
}

/** The Auth user holding the invitation email (a recorded invited_user_id is tried first). Never profiles.email. */
async function authUserFor(authAdmin, invitation) {
  if (invitation.invited_user_id) {
    const { data, error } = await authAdmin.getUserById(invitation.invited_user_id)
    if (error && error.status !== 404 && error.code !== 'user_not_found') throw new Error(`Load auth user failed: ${error.message}`)
    if (data?.user?.email?.toLowerCase() === invitation.email) return data.user
  }
  return findAuthUserByEmail(authAdmin, invitation.email)
}

/**
 * Same steps as the worker's user-invitations processor. Never creates or changes a membership.
 * Returns { userId, emailed, confirmedUser }.
 */
export async function sendInvitation(db, invitation, companyId, redirectBase, now = () => new Date()) {
  const authAdmin = db.auth.admin
  const options = {
    redirectTo: invitationRedirect(redirectBase, invitation.id),
    ...(invitation.full_name ? { data: { full_name: invitation.full_name } } : {}),
  }
  const existing = await authUserFor(authAdmin, invitation)
  let user = existing
  let emailed = false
  if (!existing?.email_confirmed_at) {
    const { data, error } = await authAdmin.inviteUserByEmail(invitation.email, options)
    if (error) {
      if (!USER_EXISTS_CODES.has(error.code)) throw new Error(`Send invitation email failed (HTTP ${error.status ?? '?'}): ${error.message}`)
      // Created or confirmed meanwhile: a confirmed user gets no email.
      user = await findAuthUserByEmail(authAdmin, invitation.email)
      if (!user) throw new Error(`Supabase Auth reports a user with ${invitation.email}, but none was found`)
    } else {
      user = data.user
      emailed = true
    }
  }

  const updated = unwrap(
    await db
      .from('company_invitations')
      .update({
        status: 'sent',
        invited_user_id: user.id,
        failure_reason: null,
        // Always stamped (see the worker): it must not reveal whether the address has an account.
        sent_at: now().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('id', invitation.id)
      .eq('status', invitation.status)
      .select('id'),
    'Record invitation',
  )
  if (updated.length === 0) throw new Error(`Invitation ${invitation.id} changed while it was being sent; re-run with --existing`)
  return { userId: user.id, emailed, confirmedUser: Boolean(user.email_confirmed_at) && !emailed }
}

async function markFailed(db, companyId, invitationId, reason) {
  const { error } = await db
    .from('company_invitations')
    .update({ status: 'failed', failure_reason: reason.slice(0, 2000) })
    .eq('company_id', companyId)
    .eq('id', invitationId)
    .eq('status', 'pending')
  if (error) console.error(`platform:create-company: could not mark the invitation failed: ${error.message}`)
}

// --------------------------------------------------------------------------- main

async function main() {
  let parsed
  try {
    parsed = parseArgs({ options: OPTIONS, allowPositionals: false, strict: true })
  } catch (error) {
    fail(error.message)
  }
  const { values } = parsed
  if (values.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 27).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'))
    return
  }

  // The root .env is only read when the process environment lacks one of the keys.
  const needsFile = ENV_KEYS.some((key) => !process.env[key]?.trim())
  const fileValues = needsFile && existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {}
  const env = Object.fromEntries(ENV_KEYS.map((key) => [key, (process.env[key] ?? fileValues[key] ?? '').trim()]))
  if (!env.SUPABASE_URL) fail('SUPABASE_URL is not set')
  if (!env.SUPABASE_SERVICE_ROLE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is not set (service role; never commit it)')
  let hosted
  try {
    hosted = isHostedUrl(env.SUPABASE_URL)
  } catch {
    fail('SUPABASE_URL is not a valid URL')
  }
  const target = new URL(env.SUPABASE_URL).host
  if (hosted && !values.hosted) fail(`SUPABASE_URL points at a hosted project (${target}); pass --hosted to create a real client company there`)

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined
  try {
    const missing = REQUIRED.filter((key) => !values[key]?.trim())
    if (missing.length) {
      if (!rl) fail(`missing required options: ${missing.map((key) => `--${key}`).join(', ')}`)
      await promptMissing(values, rl)
    }
    const provinces = await loadProvinces()
    const { company, admin } = validateInputs(values, provinces)
    const redirectTo = redirectUrlFor(values['redirect-url'], env.WEB_APP_URL, hosted)

    if (hosted) {
      if (rl) {
        const answer = await rl.question(`Create "${company.name}" (${company.initials}) and invite ${admin.email} on the HOSTED project ${target}? [y/N] `)
        if (!/^y(es)?$/i.test(answer.trim())) fail('cancelled')
      } else if (!values.yes) {
        fail('cannot ask for confirmation without a terminal; re-run with --hosted --yes')
      }
    }
    rl?.close()

    const { createClient } = createRequire(resolve(ROOT, 'backend/package.json'))('@supabase/supabase-js')
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    const matches = await findCompany(db, company)
    let companyRow
    let created = false
    if (values.existing) {
      companyRow = matches.find((row) => row.initials === company.initials)
      if (!companyRow) fail(`--existing: no company with initials ${company.initials}`)
    } else if (matches.length) {
      fail(
        `a company with these initials or this name already exists: ${matches.map((row) => `${row.name} (${row.initials}, ${row.id})`).join('; ')}. ` +
          'Re-run with --existing to (re)send its admin invitation.',
      )
    } else {
      companyRow = unwrap(await db.from('companies').insert(company).select('id, name, initials').single(), 'Create company')
      created = true
    }

    const invitation = await adminInvitation(db, companyRow.id, admin)
    let result
    if (invitation.status === 'accepted') {
      result = { userId: invitation.invited_user_id, status: 'accepted', emailed: false, confirmedUser: true }
    } else {
      try {
        result = { ...(await sendInvitation(db, invitation, companyRow.id, redirectTo)), status: 'sent' }
      } catch (error) {
        await markFailed(db, companyRow.id, invitation.id, error.message)
        fail(`${error.message}\nThe company ${created ? 'was created' : 'exists'}; fix the problem and re-run with --existing.`)
      }
    }

    const next =
      result.status === 'accepted'
        ? 'The invitation was already accepted: the admin is a member of the company.'
        : result.emailed
          ? `NOT AN ADMIN YET: the company has no admin until ${admin.email} opens the emailed link, signs in and accepts the invitation.`
          : `NOT AN ADMIN YET: ${admin.email} already has a confirmed account, so no email was sent. They must sign in to the app ` +
            'and accept the invitation there (it is listed under their invitations). The company has no admin until then.'
    console.log(
      [
        `Target:      ${hosted ? 'HOSTED' : 'local'} Supabase (${target})`,
        `Company:     ${companyRow.name} (${companyRow.initials}) ${companyRow.id}${created ? ' [created]' : ' [existing]'}`,
        `Admin:       ${admin.email} (${ADMIN_ROLE} once accepted) user ${result.userId}`,
        `Invitation:  ${invitation.id} ${result.status}${result.emailed ? ', email sent' : ', no email sent'}`,
        `Link:        ${invitationRedirect(redirectTo, invitation.id)}`,
        '',
        next,
      ].join('\n'),
    )
  } catch (error) {
    if (error instanceof UsageError) fail(error.message)
    fail(error instanceof Error ? error.message : String(error))
  } finally {
    rl?.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
