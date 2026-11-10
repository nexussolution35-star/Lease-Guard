#!/usr/bin/env node
// Configures Supabase Auth on the hosted project named by SUPABASE_URL, through the Management API:
//
//   pnpm auth:configure:remote                  dry run: shows which settings would change
//   pnpm auth:configure:remote -- --apply       shows them, asks for confirmation, then applies them
//   pnpm auth:configure:remote -- --apply --yes applies without asking (non-interactive use)
//
// What it sets:
// - custom SMTP, so invitation and password emails reach every user's own address, sent from
//   SMTP_SENDER_EMAIL (default noreply@leaseguard.com). Without SMTP_HOST/USER/PASS the SMTP part is
//   skipped and Supabase's test sender stays in use (it only delivers to the project team's addresses);
// - the branded templates in supabase/templates (invitation, password link, password-changed notice);
// - email links (invitations, password links) that expire after 3 minutes;
// - invite-only accounts (public sign-up off), secure password change (a password can only be changed
//   from a fresh email link), secure email change;
// - the site URL and the redirect allow-list entries for ${WEB_APP_URL}/auth/accept and /auth/reset-password
//   (existing allow-list entries are kept).
//
// Reads SUPABASE_URL, SUPABASE_ACCESS_TOKEN (a personal access token: Dashboard > Account > Access
// Tokens), WEB_APP_URL and SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SENDER_EMAIL,
// SMTP_SENDER_NAME from the process environment, falling back to the repository-root .env (only those
// keys are read). Secrets are never printed: the SMTP password is shown as "(set)" and templates by size.
//
// The sender's domain (leaseguard.com) must be verified with the SMTP provider (SPF and DKIM records in
// its DNS); otherwise providers refuse the mail or it lands in spam.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ENV_FILE = resolve(ROOT, '.env')
const TEMPLATES = resolve(ROOT, 'supabase/templates')
const API = 'https://api.supabase.com/v1'
const DEFAULT_SENDER_EMAIL = 'noreply@leaseguard.com'
const DEFAULT_SENDER_NAME = 'LeaseGuard'
const LINK_EXPIRY_SECONDS = 180
// Settings whose values are secret or long: shown as a marker, never printed.
const SECRET_KEYS = new Set(['smtp_pass'])

function fail(message) {
  console.error(`auth-configure-remote: ${message}`)
  process.exit(1)
}

const fileValues = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {}
const read = (name) => (process.env[name] ?? fileValues[name] ?? '').trim()

const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(read('SUPABASE_URL'))?.[1]
if (!ref) fail('SUPABASE_URL must be a hosted project URL such as https://<project-ref>.supabase.co')
const token = read('SUPABASE_ACCESS_TOKEN')
if (!token) fail('SUPABASE_ACCESS_TOKEN is not set (Dashboard > Account > Access Tokens; see .env.example)')

let webAppUrl
try {
  webAppUrl = new URL(read('WEB_APP_URL'))
} catch {
  fail('WEB_APP_URL must be the public URL of the frontend, for example https://app.example.com')
}
const origin = webAppUrl.origin

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const preapproved = args.includes('--yes')
const unknownArgs = args.filter((arg) => !['--apply', '--yes', '--dry-run'].includes(arg))
if (unknownArgs.length > 0) fail(`unknown arguments: ${unknownArgs.join(' ')}`)

async function call(method, body) {
  let response
  try {
    response = await fetch(`${API}/projects/${ref}/config/auth`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    fail(`the Management API is unreachable: ${error.message}`)
  }
  const text = await response.text()
  if (!response.ok) {
    const reason = response.status === 401 ? 'the access token was rejected' : text.split(token).join('***').slice(0, 500)
    fail(`${method} auth config failed (HTTP ${response.status}): ${reason}`)
  }
  return text ? JSON.parse(text) : {}
}

const template = (file) => {
  const path = resolve(TEMPLATES, file)
  if (!existsSync(path)) fail(`template missing: supabase/templates/${file}`)
  return readFileSync(path, 'utf8')
}

function desiredSettings(current) {
  const redirects = [`${origin}/auth/accept**`, `${origin}/auth/reset-password**`]
  const allowList = (current.uri_allow_list ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const desired = {
    site_url: origin,
    uri_allow_list: [...new Set([...allowList, ...redirects])].join(','),
    disable_signup: true,
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    security_update_password_require_reauthentication: true,
    // Email links (invitations, password links) expire after 3 minutes, as in supabase/config.toml.
    mailer_otp_exp: LINK_EXPIRY_SECONDS,
    mailer_subjects_invite: 'You have been invited to LeaseGuard',
    mailer_templates_invite_content: template('invite.html'),
    mailer_subjects_recovery: 'Set your LeaseGuard password',
    mailer_templates_recovery_content: template('recovery.html'),
    mailer_notifications_password_changed_enabled: true,
    mailer_subjects_password_changed_notification: 'Your LeaseGuard password was changed',
    mailer_templates_password_changed_notification_content: template('password_changed_notification.html'),
  }

  const smtp = { host: read('SMTP_HOST'), user: read('SMTP_USER'), pass: read('SMTP_PASS') }
  const missing = Object.entries(smtp)
    .filter(([, value]) => !value)
    .map(([key]) => `SMTP_${key.toUpperCase()}`)
  if (missing.length === Object.keys(smtp).length) {
    console.log('SMTP: not configured (SMTP_HOST, SMTP_USER and SMTP_PASS are empty); skipping custom SMTP.')
    console.log("      Supabase's test sender stays in use and only delivers to the project team's addresses.\n")
    return desired
  }
  if (missing.length > 0) fail(`custom SMTP needs ${missing.join(', ')} as well (see .env.example)`)

  const senderEmail = read('SMTP_SENDER_EMAIL') || DEFAULT_SENDER_EMAIL
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) fail('SMTP_SENDER_EMAIL is not an email address')
  const port = Number(read('SMTP_PORT') || '587')
  if (!Number.isInteger(port) || port <= 0 || port > 65535) fail('SMTP_PORT must be a port number such as 587 or 465')
  if (port === 25) fail('SMTP_PORT 25 is blocked by Supabase; use 587 or 465')
  // The API returns the port as a string; send it in the same type.
  return {
    ...desired,
    smtp_host: smtp.host,
    smtp_port: typeof current.smtp_port === 'string' ? String(port) : port,
    smtp_user: smtp.user,
    smtp_pass: smtp.pass,
    smtp_admin_email: senderEmail,
    smtp_sender_name: read('SMTP_SENDER_NAME') || DEFAULT_SENDER_NAME,
  }
}

const show = (key, value) => {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (SECRET_KEYS.has(key)) return '(set)'
  if (typeof value === 'string' && value.length > 80) return `(${value.length} characters)`
  return JSON.stringify(value)
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((done) =>
    rl.question(question, (answer) => {
      rl.close()
      done(/^y(es)?$/i.test(answer.trim()))
    }),
  )
}

console.log(`Target: Auth settings of project ${ref}\n`)
const current = await call('GET')
const desired = desiredSettings(current)

// Only settings the API reports are sent: a name it does not know would be ignored or rejected.
const unknown = Object.keys(desired).filter((key) => !(key in current))
for (const key of unknown) {
  console.warn(`warning: the Management API does not report "${key}"; it is left out`)
  delete desired[key]
}

// The SMTP password cannot be compared (the API does not return it), so it is always sent with SMTP.
const changes = Object.entries(desired).filter(([key, value]) => key === 'smtp_pass' || String(current[key] ?? '') !== String(value))
if (changes.length === 0) {
  console.log('Auth settings are already up to date.')
  process.exit(0)
}
for (const [key, value] of changes) {
  console.log(`  ${key}: ${SECRET_KEYS.has(key) ? '' : `${show(key, current[key])} -> `}${show(key, value)}`)
}
if (desired.smtp_admin_email) {
  const domain = desired.smtp_admin_email.split('@')[1]
  console.log(`\nEmails will be sent from ${desired.smtp_admin_email}. ${domain} must be verified with the SMTP provider (SPF/DKIM).`)
}

if (!apply) {
  console.log('\nDry run only. Re-run with -- --apply to apply these settings.')
  process.exit(0)
}
if (!preapproved) {
  if (!process.stdin.isTTY) fail('cannot ask for confirmation without a terminal; re-run with -- --apply --yes')
  if (!(await confirm(`\nApply these settings to project ${ref}? [y/N] `))) fail('cancelled; nothing was changed')
}
await call('PATCH', Object.fromEntries(changes))
console.log('\nAuth settings applied.')
if (desired.smtp_host) {
  console.log('Supabase limits custom SMTP to 30 emails per hour at first: raise it under Authentication > Rate Limits if needed.')
}
