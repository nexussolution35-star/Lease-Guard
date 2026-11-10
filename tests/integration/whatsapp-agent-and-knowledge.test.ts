import { unwrap } from '@leaseguard/api-client'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { WorldUserKey } from '../fixtures/world.ts'
import { apiAs, apiErrorOf, check, integration, serviceRole, world } from './support/clients.ts'

/**
 * Each company's AI agent and knowledge base (ticket 09) against the real API, database and storage: one
 * configuration per company that only its company admins change; FAQs, knowledge entries and documents that are
 * drafts until a company admin approves them; and the agent runtime's read (whatsapp_agent_knowledge, service role)
 * that returns only that company's approved knowledge.
 */

const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`

/** A Supabase client signed in as a world user (Row Level Security applies). */
function signedIn(user: WorldUserKey): SupabaseClient {
  const ctx = integration()
  return createClient(ctx.supabaseUrl, ctx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.accessTokens[user]}` } },
  })
}

const config = (handoverContactUserIds: string[]) => ({
  agentName: `Atlas assistant ${unique}`,
  businessDescription: 'Atlas Properties lets retail space in Gauteng.',
  tone: 'Warm and brief',
  timezone: 'Africa/Johannesburg',
  operatingHours: [
    { day: 'monday' as const, opens: '08:00', closes: '17:00' },
    { day: 'saturday' as const, opens: '09:00', closes: '13:00' },
  ],
  languages: ['en' as const, 'zu' as const],
  policies: 'Never discuss rent amounts.',
  supportInstructions: 'Offer to take a message.',
  escalationRules: 'Complaints go to a person.',
  permittedActions: ['answer_faq' as const, 'share_business_info' as const],
  autoReplyEnabled: true,
  outOfHoursMessage: 'We are closed; we will reply on the next working day.',
  handoverContactUserIds,
})

describe('Agent configuration', () => {
  it('starts with safe defaults, is saved by company admins only and read by every member', async () => {
    const users = world().users
    const initial = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/agent'))
    expect(initial).toMatchObject({ companyId: world().companies.a.id, autoReplyEnabled: false, permittedActions: [], timezone: 'Africa/Johannesburg' })

    for (const user of ['manager', 'readOnly', 'owner'] as const) {
      expect((await apiErrorOf(unwrap(apiAs(user, 'a').PUT('/api/v1/whatsapp/agent', { body: config([]) })))).status).toBe(403)
    }
    const saved = await unwrap(apiAs('admin', 'a').PUT('/api/v1/whatsapp/agent', { body: config([users.manager.id, users.admin.id]) }))
    expect(saved).toMatchObject({
      configured: true,
      agentName: `Atlas assistant ${unique}`,
      autoReplyEnabled: true,
      languages: ['en', 'zu'],
      updatedByUserId: users.admin.id,
    })
    expect(saved.handoverContacts.map((c) => c.name).sort()).toEqual([users.admin.fullName, users.manager.fullName].sort())

    const read = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/agent'))
    expect(read).toMatchObject({ configured: true, outOfHoursMessage: 'We are closed; we will reply on the next working day.' })
    expect(read.operatingHours).toHaveLength(2)

    // Handover contacts are the company's active admins and property managers only.
    const invalid = await apiErrorOf(unwrap(apiAs('admin', 'a').PUT('/api/v1/whatsapp/agent', { body: config([users.readOnly.id]) })))
    expect(invalid.status).toBe(422)
    const overlapping = await apiErrorOf(
      unwrap(
        apiAs('admin', 'a').PUT('/api/v1/whatsapp/agent', {
          body: { ...config([]), operatingHours: [{ day: 'monday', opens: '08:00', closes: '13:00' }, { day: 'monday', opens: '12:00', closes: '17:00' }] },
        }),
      ),
    )
    expect(overlapping.status).toBe(400)
  })

  it("keeps each company's configuration to itself", async () => {
    // The manager belongs to both companies: with B active they see B's (unsaved) configuration, not A's.
    const b = await unwrap(apiAs('manager', 'b').GET('/api/v1/whatsapp/agent'))
    expect(b).toMatchObject({ companyId: world().companies.b.id, configured: false })
    // The admin of A is not a member of B.
    expect((await apiErrorOf(unwrap(apiAs('admin', 'b').GET('/api/v1/whatsapp/agent')))).status).toBe(403)
    const direct = await signedIn('admin').from('whatsapp_agent_configs').select('company_id')
    expect(direct.error).toBeNull()
    expect((direct.data ?? []).map((row) => row.company_id)).not.toContain(world().companies.b.id)
  })
})

describe('Knowledge base', () => {
  it('keeps FAQs and entries in draft until a company admin approves them, and changes return them to draft', async () => {
    const admin = apiAs('admin', 'a')
    expect((await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/whatsapp/agent/faqs', { body: { question: 'Q?', answer: 'A.' } })))).status).toBe(403)

    const faq = await unwrap(admin.POST('/api/v1/whatsapp/agent/faqs', { body: { question: `Where do visitors park ${unique}?`, answer: 'Basement level P2.' } }))
    expect(faq).toMatchObject({ status: 'draft', createdByUserId: world().users.admin.id })
    const path = { params: { path: { faqId: faq.id } } }
    const approved = await unwrap(admin.POST('/api/v1/whatsapp/agent/faqs/{faqId}/approve', path))
    expect(approved).toMatchObject({ status: 'approved', approvedByUserId: world().users.admin.id, approvedByName: world().users.admin.fullName })
    const edited = await unwrap(admin.PATCH('/api/v1/whatsapp/agent/faqs/{faqId}', { ...path, body: { answer: 'Basement level P1.' } }))
    expect(edited).toMatchObject({ status: 'draft', answer: 'Basement level P1.' })
    expect(edited.approvedAt).toBeUndefined()
    await unwrap(admin.POST('/api/v1/whatsapp/agent/faqs/{faqId}/approve', path))

    const entry = await unwrap(admin.POST('/api/v1/whatsapp/agent/knowledge-entries', { body: { title: `Office hours ${unique}`, content: 'Weekdays 08:00 to 17:00.' } }))
    expect(entry.status).toBe('draft')
    const entryPath = { params: { path: { entryId: entry.id } } }
    await unwrap(admin.POST('/api/v1/whatsapp/agent/knowledge-entries/{entryId}/approve', entryPath))
    await expect(unwrap(admin.POST('/api/v1/whatsapp/agent/knowledge-entries/{entryId}/withdraw', entryPath))).resolves.toMatchObject({ status: 'draft' })
    const draft = await unwrap(admin.POST('/api/v1/whatsapp/agent/faqs', { body: { question: `Draft question ${unique}?`, answer: 'Not approved yet.' } }))

    // Every member reads the knowledge base, drafts included.
    const listed = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/agent/faqs'))
    expect(listed.map((f) => [f.id, f.status])).toEqual(expect.arrayContaining([[faq.id, 'approved'], [draft.id, 'draft']]))
    // Not another company's.
    expect(await unwrap(apiAs('manager', 'b').GET('/api/v1/whatsapp/agent/faqs'))).toEqual([])
    expect((await apiErrorOf(unwrap(apiAs('manager', 'a').DELETE('/api/v1/whatsapp/agent/faqs/{faqId}', path)))).status).toBe(403)

    // The agent runtime gets the approved FAQ and none of the drafts.
    const knowledge = check(await serviceRole().rpc('whatsapp_agent_knowledge', { p_company_id: world().companies.a.id }), 'Read the agent knowledge') as {
      faqs: { question: string }[]
      entries: { title: string }[]
      config: { agentName: string } | null
    }
    expect(knowledge.faqs.map((f) => f.question)).toContain(`Where do visitors park ${unique}?`)
    expect(knowledge.faqs.map((f) => f.question)).not.toContain(`Draft question ${unique}?`)
    expect(knowledge.entries.map((e) => e.title)).not.toContain(`Office hours ${unique}`)
    const other = check(await serviceRole().rpc('whatsapp_agent_knowledge', { p_company_id: world().companies.b.id }), 'Read B') as { faqs: unknown[]; config: unknown }
    expect(JSON.stringify(other)).not.toContain(unique)

    // Signed-in users never read the agent's view directly.
    expect((await signedIn('admin').rpc('whatsapp_agent_knowledge', { p_company_id: world().companies.a.id })).error).not.toBeNull()

    await unwrap(admin.DELETE('/api/v1/whatsapp/agent/faqs/{faqId}', { params: { path: { faqId: draft.id } } }))
    expect((await apiErrorOf(unwrap(admin.DELETE('/api/v1/whatsapp/agent/faqs/{faqId}', { params: { path: { faqId: draft.id } } })))).status).toBe(404)
  })

  it('uploads a document to the company folder, registers it as a draft, lets members read it and approves it', async () => {
    const admin = apiAs('admin', 'a')
    const content = `Atlas leasing brochure ${unique}`
    const file = { fileName: 'Leasing brochure.txt', mimeType: 'text/plain' as const, sizeBytes: Buffer.byteLength(content) }
    expect((await apiErrorOf(unwrap(apiAs('manager', 'a').POST('/api/v1/whatsapp/agent/documents/upload-url', { body: file })))).status).toBe(403)

    const upload = await unwrap(admin.POST('/api/v1/whatsapp/agent/documents/upload-url', { body: file }))
    expect(upload.storagePath).toBe(`${world().companies.a.id}/${upload.documentId}/Leasing-brochure.txt`)

    // Registering before the file is there is refused.
    const early = await apiErrorOf(unwrap(admin.POST('/api/v1/whatsapp/agent/documents', { body: { ...file, storagePath: upload.storagePath, title: 'Brochure' } })))
    expect(early.status).toBe(422)

    const put = await fetch(upload.signedUrl, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: content })
    expect(put.ok).toBe(true)
    const document = await unwrap(admin.POST('/api/v1/whatsapp/agent/documents', { body: { ...file, storagePath: upload.storagePath, title: 'Leasing brochure' } }))
    expect(document).toMatchObject({ id: upload.documentId, status: 'draft', fileName: 'Leasing brochure.txt', sizeBytes: file.sizeBytes })

    const link = await unwrap(apiAs('readOnly', 'a').GET('/api/v1/whatsapp/agent/documents/{documentId}/download-url', { params: { path: { documentId: document.id } } }))
    expect(await (await fetch(link.url)).text()).toBe(content)
    expect((await apiErrorOf(unwrap(apiAs('manager', 'b').GET('/api/v1/whatsapp/agent/documents/{documentId}/download-url', { params: { path: { documentId: document.id } } })))).status).toBe(404)

    await expect(
      unwrap(admin.POST('/api/v1/whatsapp/agent/documents/{documentId}/approve', { params: { path: { documentId: document.id } } })),
    ).resolves.toMatchObject({ status: 'approved' })
    const knowledge = check(await serviceRole().rpc('whatsapp_agent_knowledge', { p_company_id: world().companies.a.id }), 'Read the agent knowledge') as {
      documents: { id: string }[]
    }
    expect(knowledge.documents.map((d) => d.id)).toContain(document.id)

    await unwrap(admin.DELETE('/api/v1/whatsapp/agent/documents/{documentId}', { params: { path: { documentId: document.id } } }))
    const gone = await serviceRole().storage.from('agent-knowledge').list(`${world().companies.a.id}/${document.id}`)
    expect(gone.data ?? []).toEqual([])
  })

  it('refuses to register a document as a different media type than the one Storage holds', async () => {
    const admin = apiAs('admin', 'a')
    const content = `not really text ${unique}`
    const file = { fileName: 'Floor plan.txt', mimeType: 'text/plain' as const, sizeBytes: Buffer.byteLength(content) }
    const upload = await unwrap(admin.POST('/api/v1/whatsapp/agent/documents/upload-url', { body: file }))

    // The bucket accepts image/png, so Storage stores the object as a PNG.
    const put = await fetch(upload.signedUrl, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: content })
    expect(put.ok).toBe(true)

    const refused = await apiErrorOf(unwrap(admin.POST('/api/v1/whatsapp/agent/documents', { body: { ...file, storagePath: upload.storagePath, title: 'Floor plan' } })))
    expect(refused.status).toBe(422)
    const registered = await signedIn('admin').from('whatsapp_knowledge_documents').select('id').eq('id', upload.documentId)
    expect(registered.data ?? []).toEqual([])
  })
})
