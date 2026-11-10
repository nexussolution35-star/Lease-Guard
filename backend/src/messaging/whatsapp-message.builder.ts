import type { TemplateComponent, WhatsAppMessage } from '../infrastructure/whatsapp/whatsapp-channels'

/** The Meta-registered template a communication was rendered from. */
export interface ApprovedTemplate {
  metaTemplateName: string
  /** Meta language code, e.g. `en_ZA`. */
  language: string
  /** Body with numbered placeholders {{1}}, {{2}}, … exactly as registered. */
  body: string
  supportsDocumentAttachment: boolean
}

/** An uploaded attachment (WhatsApp media id). */
export interface UploadedDocument {
  mediaId: string
  fileName: string
}

/** The rendered message cannot be expressed as the approved WhatsApp message; never sent. */
export class MessageBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MessageBuildError'
  }
}

const PLACEHOLDER = /\{\{(\d+)\}\}/g
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Recovers the template parameters from the rendered body: the body the property manager approved is
 * the template with each {{n}} replaced. Returns the values ordered {{1}}, {{2}}, …, or null when the
 * body does not follow the template (the approved text and what WhatsApp would show would differ).
 */
export function templateParameters(templateBody: string, renderedBody: string): string[] | null {
  const numbers: number[] = []
  let pattern = '^'
  let last = 0
  for (const match of templateBody.matchAll(PLACEHOLDER)) {
    pattern += `${escapeRegExp(templateBody.slice(last, match.index))}([\\s\\S]+?)`
    numbers.push(Number(match[1]))
    last = match.index + match[0].length
  }
  pattern += `${escapeRegExp(templateBody.slice(last))}$`
  const found = new RegExp(pattern).exec(renderedBody)
  if (!found) return null

  const values = new Map<number, string>()
  for (let i = 0; i < numbers.length; i++) {
    const value = found[i + 1]
    const previous = values.get(numbers[i])
    if (previous !== undefined && previous !== value) return null
    values.set(numbers[i], value)
  }
  const ordered: string[] = []
  for (let n = 1; n <= values.size; n++) {
    const value = values.get(n)
    if (value === undefined || value.trim() === '') return null
    ordered.push(value)
  }
  return ordered
}

/**
 * The Cloud API message for an approved communication:
 * - with a template: a template message whose body parameters reproduce the approved text exactly,
 *   plus the document as header when the template supports one;
 * - without a template: plain text, or the document with the text as caption.
 */
export function buildWhatsAppMessage(body: string, template: ApprovedTemplate | undefined, document: UploadedDocument | undefined): WhatsAppMessage {
  if (template) {
    const parameters = templateParameters(template.body, body)
    if (!parameters) throw new MessageBuildError(`The approved text does not match WhatsApp template "${template.metaTemplateName}"`)
    if (document && !template.supportsDocumentAttachment) {
      throw new MessageBuildError(`WhatsApp template "${template.metaTemplateName}" does not support a document attachment`)
    }
    const components: TemplateComponent[] = []
    if (document) {
      components.push({ type: 'header', parameters: [{ type: 'document', document: { id: document.mediaId, filename: document.fileName } }] })
    }
    if (parameters.length > 0) components.push({ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) })
    return { type: 'template', template: { name: template.metaTemplateName, language: { code: template.language }, components } }
  }
  if (document) return { type: 'document', document: { id: document.mediaId, filename: document.fileName, caption: body } }
  return { type: 'text', text: { body, preview_url: false } }
}
