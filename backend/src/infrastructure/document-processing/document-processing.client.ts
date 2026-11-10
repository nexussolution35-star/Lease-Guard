import type { DocumentExtractionRequest, DocumentExtractionResult } from '@leaseguard/domain'

import { documentExtractionResultSchema, documentProcessingErrorSchema } from './document-processing.schemas'

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export interface DocumentProcessingClientOptions {
  /** DOCUMENT_PROCESSING_URL, e.g. http://localhost:8000 */
  baseUrl: string
  /** DOCUMENT_PROCESSING_TOKEN (bearer). Never logged. */
  token: string
  /** Injected for tests; defaults to the global fetch. */
  fetch?: FetchFn
  /** Per-request timeout. Extraction with OCR can take a while. Default 120 s. */
  timeoutMs?: number
}

/**
 * A failed extraction request. `retryable` is true for transient conditions (network errors, timeouts,
 * HTTP 408/429 and 5xx); false for permanent ones (other 4xx such as an unreadable or encrypted PDF,
 * authentication errors, and responses that break the wire contract), which must not be retried.
 */
export class DocumentProcessingError extends Error {
  readonly retryable: boolean
  readonly status: number | undefined
  /** Service error code (`DocumentProcessingErrorCode`), `contract_violation` or `network_error`. */
  readonly code: string

  constructor(message: string, options: { retryable: boolean; code: string; status?: number }) {
    super(message)
    this.name = 'DocumentProcessingError'
    this.retryable = options.retryable
    this.code = options.code
    this.status = options.status
  }
}

/** HTTP statuses worth retrying: timeouts, rate limiting and server-side failures. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

const DEFAULT_TIMEOUT_MS = 120_000

/** Client for the document-processing service (`POST {DOCUMENT_PROCESSING_URL}/v1/extractions`). */
export class DocumentProcessingClient {
  private readonly endpoint: string
  private readonly fetchFn: FetchFn
  private readonly timeoutMs: number

  constructor(private readonly options: DocumentProcessingClientOptions) {
    this.endpoint = new URL('/v1/extractions', options.baseUrl).toString()
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Sends one statement PDF with its camelCase form fields and returns the validated extraction
   * proposal. Throws DocumentProcessingError (see `retryable`).
   */
  async extract(file: Blob, fileName: string, request: DocumentExtractionRequest): Promise<DocumentExtractionResult> {
    const form = new FormData()
    form.append('file', file, fileName)
    form.append('companyId', request.companyId)
    form.append('statementId', request.statementId)
    form.append('sourceSystem', request.sourceSystem)
    for (const name of request.expectedTenantNames ?? []) form.append('expectedTenantNames', name)
    for (const unit of request.expectedUnitNumbers ?? []) form.append('expectedUnitNumbers', unit)

    let response: Response
    try {
      response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.token}`, Accept: 'application/json' },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      throw new DocumentProcessingError(`Document processing service unreachable (${reason})`, {
        retryable: true,
        code: 'network_error',
      })
    }

    const body: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const parsed = documentProcessingErrorSchema.safeParse(body)
      const code = parsed.success ? parsed.data.code : 'unknown'
      const detail = parsed.success ? parsed.data.message : 'no error details'
      throw new DocumentProcessingError(`Document processing failed with HTTP ${response.status} (${code}): ${detail}`, {
        retryable: isRetryableStatus(response.status),
        code,
        status: response.status,
      })
    }

    const parsed = documentExtractionResultSchema.safeParse(body)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')
      throw new DocumentProcessingError(`Document processing response breaks the extraction contract: ${issues}`, {
        retryable: false,
        code: 'contract_violation',
        status: response.status,
      })
    }
    return parsed.data
  }
}
