import { describe, expect, it } from 'vitest'

import {
  type CompanyMatch,
  type ImportPlan,
  importTestNumber,
  type NumberImportStore,
  type TestNumberSettings,
  type VerificationStarter,
} from './whatsapp-test-number-import'

const NEXUS: CompanyMatch = { id: '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e', name: 'Nexus Solution', initials: 'NS', status: 'active' }
const NUMBER_ID = '7a1d2c1e-0000-4000-8000-000000000009'
const SETTINGS: TestNumberSettings = {
  accessToken: 'EAAG-the-installation-test-number-token-0123456789',
  phoneNumberId: '660001',
  businessAccountId: '771001',
}
const TARGET = 'local Supabase (127.0.0.1:54321)'

function plan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return { outcome: 'new_number', applied: false, companyName: NEXUS.name, secretsDeleted: 0, ...overrides }
}

interface HarnessOptions {
  companies?: CompanyMatch[]
  dryRun?: ImportPlan | Error
  applied?: ImportPlan | Error
  verification?: 'queued' | 'already_running' | Error
  interactive?: boolean
  answer?: boolean
}

function harness(options: HarnessOptions = {}) {
  const lines: string[] = []
  const imports: { companyId: string; settings: TestNumberSettings; apply: boolean }[] = []
  const verifications: { companyId: string; numberId: string }[] = []
  const questions: string[] = []
  const store: NumberImportStore = {
    async findCompanies() {
      return options.companies ?? [NEXUS]
    },
    async importNumber(companyId, settings, apply) {
      imports.push({ companyId, settings, apply })
      const answer = apply ? (options.applied ?? plan({ applied: true, numberId: NUMBER_ID })) : (options.dryRun ?? plan())
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  const verification: VerificationStarter = {
    async start(companyId, numberId) {
      verifications.push({ companyId, numberId })
      const outcome = options.verification ?? 'queued'
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  }
  const terminal = {
    interactive: options.interactive ?? false,
    print: (line: string) => lines.push(line),
    confirm: async (question: string) => {
      questions.push(question)
      return options.answer ?? false
    },
  }
  const run = (flags: { apply?: boolean; yes?: boolean } = {}) =>
    importTestNumber({ company: 'NS', apply: flags.apply ?? false, yes: flags.yes ?? false, target: TARGET }, SETTINGS, { store, verification, terminal })
  const output = () => lines.join('\n')
  return { run, lines, output, imports, verifications, questions }
}

describe('importTestNumber', () => {
  it('is a dry run by default: shows the company and the number it would connect, and changes nothing', async () => {
    const h = harness()
    await expect(h.run()).resolves.toBe(0)
    expect(h.imports).toEqual([{ companyId: NEXUS.id, settings: SETTINGS, apply: false }])
    expect(h.verifications).toEqual([])
    expect(h.output()).toContain(`Company:      Nexus Solution (NS) ${NEXUS.id}`)
    expect(h.output()).toContain('Number:       phone number id 660001 in WhatsApp Business Account 771001')
    expect(h.output()).toContain('Dry run: nothing was changed.')
    expect(h.output()).toContain('--apply')
  })

  it('applies only after the operator confirms on a terminal', async () => {
    const declined = harness({ interactive: true, answer: false })
    await expect(declined.run({ apply: true })).resolves.toBe(1)
    expect(declined.questions).toHaveLength(1)
    expect(declined.questions[0]).toContain('Nexus Solution')
    expect(declined.imports.map((i) => i.apply)).toEqual([false])
    expect(declined.output()).toContain('Cancelled')

    const confirmed = harness({ interactive: true, answer: true })
    await expect(confirmed.run({ apply: true })).resolves.toBe(0)
    expect(confirmed.imports.map((i) => i.apply)).toEqual([false, true])
    expect(confirmed.verifications).toEqual([{ companyId: NEXUS.id, numberId: NUMBER_ID }])
  })

  it('needs --yes to apply without a terminal, and then does not ask', async () => {
    const refused = harness({ interactive: false })
    await expect(refused.run({ apply: true })).resolves.toBe(1)
    expect(refused.imports.map((i) => i.apply)).toEqual([false])
    expect(refused.output()).toContain('--apply --yes')

    const unattended = harness({ interactive: false })
    await expect(unattended.run({ apply: true, yes: true })).resolves.toBe(0)
    expect(unattended.questions).toEqual([])
    expect(unattended.imports.map((i) => i.apply)).toEqual([false, true])
  })

  it('starts the same verification Embedded Signup uses, and says the number is connected only once it passes', async () => {
    const h = harness()
    await expect(h.run({ apply: true, yes: true })).resolves.toBe(0)
    expect(h.verifications).toEqual([{ companyId: NEXUS.id, numberId: NUMBER_ID }])
    expect(h.output()).toContain(`Number id:    ${NUMBER_ID}`)
    expect(h.output()).toMatch(/pending verification/)
    expect(h.output()).toMatch(/Connected only after every check passes/)
    expect(h.output()).toMatch(/WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID are not used for sending/)
  })

  it('reports a verification that was already queued or running', async () => {
    const h = harness({ verification: 'already_running' })
    await expect(h.run({ apply: true, yes: true })).resolves.toBe(0)
    expect(h.output()).toMatch(/already queued or running/)
  })

  it('fails clearly when verification cannot be queued, after the number was stored', async () => {
    const h = harness({ verification: new Error('Background processing is not available; try again shortly') })
    await expect(h.run({ apply: true, yes: true })).resolves.toBe(1)
    expect(h.output()).toMatch(/could not be queued/)
    expect(h.output()).toMatch(/Verify again/)
  })

  it.each([
    ['company_not_active', /is not active/],
    ['number_in_use', /belongs to another company: Kgalagadi Property Holdings \(20000000-0000-4000-8000-000000000002\)/],
    ['account_in_use', /WhatsApp Business Account 771001 belongs to another company: Kgalagadi Property Holdings/],
  ] as const)('refuses %s and changes nothing, even with --apply --yes', async (outcome, message) => {
    const h = harness({
      dryRun: plan({ outcome, conflictingCompany: { id: '20000000-0000-4000-8000-000000000002', name: 'Kgalagadi Property Holdings' } }),
    })
    await expect(h.run({ apply: true, yes: true })).resolves.toBe(1)
    expect(h.output()).toMatch(message)
    expect(h.imports.map((i) => i.apply)).toEqual([false])
    expect(h.verifications).toEqual([])
  })

  it('refuses a company that does not exist, and an ambiguous one', async () => {
    const missing = harness({ companies: [] })
    await expect(missing.run({ apply: true, yes: true })).resolves.toBe(1)
    expect(missing.output()).toMatch(/No company matches NS/)
    expect(missing.imports).toEqual([])

    const ambiguous = harness({ companies: [NEXUS, { ...NEXUS, id: '3ab0fc4a-eadb-50b8-bc4d-000000000002', name: 'North Star' }] })
    await expect(ambiguous.run()).resolves.toBe(1)
    expect(ambiguous.output()).toMatch(/2 companies match NS/)
    expect(ambiguous.output()).toContain('North Star')
    expect(ambiguous.imports).toEqual([])
  })

  it('stops when the company disappeared or the number was taken between the dry run and applying', async () => {
    const h = harness({ applied: plan({ outcome: 'number_in_use', conflictingCompany: { id: 'c2', name: 'Other' } }) })
    await expect(h.run({ apply: true, yes: true })).resolves.toBe(1)
    expect(h.verifications).toEqual([])
  })

  it('leaves a number that is already connected with this token alone', async () => {
    const h = harness({ dryRun: plan({ outcome: 'already_connected', numberId: NUMBER_ID, previousStatus: 'connected' }) })
    await expect(h.run({ apply: true, yes: true })).resolves.toBe(0)
    expect(h.output()).toMatch(/already connected/)
    expect(h.imports.map((i) => i.apply)).toEqual([false])
    expect(h.verifications).toEqual([])
  })

  it('explains re-running: the same token is kept, a newer token replaces the stored one', async () => {
    const unchanged = harness({ dryRun: plan({ outcome: 'token_unchanged', numberId: NUMBER_ID, previousStatus: 'error' }) })
    await unchanged.run()
    expect(unchanged.output()).toMatch(/already stored for this number/)

    const newer = harness({
      dryRun: plan({ outcome: 'token_stored', numberId: NUMBER_ID, previousStatus: 'connected' }),
      applied: plan({ outcome: 'token_stored', applied: true, numberId: NUMBER_ID, previousStatus: 'connected', secretsDeleted: 1 }),
    })
    await expect(newer.run({ apply: true, yes: true })).resolves.toBe(0)
    expect(newer.output()).toMatch(/replacing its current credential/)
    expect(newer.output()).toMatch(/1 earlier token deleted/)
    expect(newer.verifications).toHaveLength(1)
  })

  it('never prints the token, not even inside an error', async () => {
    const h = harness({ applied: new Error(`insert failed: ${SETTINGS.accessToken} is not allowed`) })
    await expect(h.run({ apply: true, yes: true })).resolves.toBe(1)
    expect(h.output()).toContain('insert failed')
    expect(h.output()).not.toContain(SETTINGS.accessToken)
    expect(h.output()).toContain('[redacted]')
    for (const run of [harness(), harness({ interactive: true, answer: true })]) {
      await run.run({ apply: true, yes: true })
      expect(run.output()).not.toContain(SETTINGS.accessToken)
      expect(run.questions.join('\n')).not.toContain(SETTINGS.accessToken)
    }
  })
})
