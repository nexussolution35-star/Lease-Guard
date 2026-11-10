import { describe, expect, it } from 'vitest'

import { buildWhatsAppMessage, MessageBuildError, templateParameters } from './whatsapp-message.builder'

const template = {
  metaTemplateName: 'overdue_payment_reminder_v1',
  language: 'en_ZA',
  body: 'Dear {{1}}, your statement of {{2}} shows {{3}} outstanding. Please contact your property manager.',
  supportsDocumentAttachment: false,
}
const rendered = 'Dear Test Trading, your statement of 01 Oct 2026 shows R 12 500,00 outstanding. Please contact your property manager.'

describe('templateParameters', () => {
  it('recovers the placeholder values from the approved text', () => {
    expect(templateParameters(template.body, rendered)).toEqual(['Test Trading', '01 Oct 2026', 'R 12 500,00'])
  })

  it('handles out-of-order and repeated placeholders, and templates without any', () => {
    expect(templateParameters('{{2}} owes {{1}}; {{2}} please pay', 'Acme owes R 5,00; Acme please pay')).toEqual(['R 5,00', 'Acme'])
    expect(templateParameters('{{1}} and {{1}}', 'a and b')).toBeNull()
    expect(templateParameters('Your statement is attached.', 'Your statement is attached.')).toEqual([])
  })

  it('returns null when the text does not follow the template', () => {
    expect(templateParameters(template.body, 'Dear Test Trading, please pay now.')).toBeNull()
    expect(templateParameters('Hi {{1}} ({{3}})', 'Hi a (b)')).toBeNull()
  })
})

describe('buildWhatsAppMessage', () => {
  it('builds a template message whose parameters reproduce the approved text', () => {
    expect(buildWhatsAppMessage(rendered, template, undefined)).toEqual({
      type: 'template',
      template: {
        name: 'overdue_payment_reminder_v1',
        language: { code: 'en_ZA' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Test Trading' },
              { type: 'text', text: '01 Oct 2026' },
              { type: 'text', text: 'R 12 500,00' },
            ],
          },
        ],
      },
    })
  })

  it('adds the statement as a document header only when the template supports it', () => {
    const document = { mediaId: 'media-1', fileName: 'statement.pdf' }
    expect(() => buildWhatsAppMessage(rendered, template, document)).toThrow(MessageBuildError)
    const message = buildWhatsAppMessage(rendered, { ...template, supportsDocumentAttachment: true }, document)
    expect(message.type === 'template' && message.template.components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'document', document: { id: 'media-1', filename: 'statement.pdf' } }],
    })
  })

  it('refuses to send text that differs from the template', () => {
    expect(() => buildWhatsAppMessage('Something else', template, undefined)).toThrow(/does not match WhatsApp template/)
  })

  it('sends plain text or a captioned document without a template', () => {
    expect(buildWhatsAppMessage('Hello', undefined, undefined)).toEqual({ type: 'text', text: { body: 'Hello', preview_url: false } })
    expect(buildWhatsAppMessage('Hello', undefined, { mediaId: 'm', fileName: 'f.pdf' })).toEqual({
      type: 'document',
      document: { id: 'm', filename: 'f.pdf', caption: 'Hello' },
    })
  })
})
