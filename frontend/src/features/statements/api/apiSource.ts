import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient, type DuplicateStatementErrorDto } from '@leaseguard/api-client'
import { STATEMENT_UPLOAD_MIME_TYPE, type Statement, type StatementExtraction, type StatementListItem } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { StatementSource } from './source'

/** Thrown when the file could not be sent to storage after the API signed the upload. */
export class StatementUploadError extends Error {
  constructor(status: number) {
    super(`The file could not be sent to storage (storage answered ${status}). Try again.`)
    this.name = 'StatementUploadError'
  }
}

function isDuplicateBody(body: unknown): body is DuplicateStatementErrorDto {
  if (typeof body !== 'object' || body === null || !('duplicate' in body)) return false
  const { duplicate } = body
  return typeof duplicate === 'object' && duplicate !== null && 'existingStatementId' in duplicate
}

/**
 * Review (`GET .../extraction`, `GET .../download-url`, `PUT .../extraction/fields/{fieldName}/correction`,
 * `POST .../extraction/fields/{fieldName}/confirm`, `PUT .../match`) and its outcome (`POST .../verify`, `POST .../reject`,
 * `POST .../mark-duplicate`, and `POST /api/v1/statements/verify` for several at once) go through the same source.
 *
 * Statements from the LeaseGuard API (`GET /api/v1/statements`, `GET /api/v1/statements/{statementId}`,
 * `POST /api/v1/statements/{statementId}/process`) and uploads (`POST /api/v1/statements/upload-url`, then the file
 * straight to storage with the signed URL, then `POST /api/v1/statements`). `send` is the browser's fetch for the
 * storage upload, replaceable in tests.
 */
export function createApiStatementSource(api: ApiClient, send: typeof fetch = (...args) => globalThis.fetch(...args)): StatementSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/statements', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              propertyId: params.propertyId,
              tenantId: params.tenantId,
              leaseId: params.leaseId,
              sourceSystem: params.sourceSystem,
              uploadBatchId: params.uploadBatchId,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies StatementListItem[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const statement: Statement = await unwrap(
          api.GET('/api/v1/statements/{statementId}', {
            params: { path: { statementId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return statement
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },

    retryProcessing(companyId, id) {
      return unwrap(
        api.POST('/api/v1/statements/{statementId}/process', {
          params: { path: { statementId: id } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },

    async upload(companyId, { file, sha256, propertyId, sourceSystem, uploadBatchId }, onPhase) {
      const headers = { [COMPANY_ID_HEADER]: companyId }
      const details = { fileName: file.name, mimeType: STATEMENT_UPLOAD_MIME_TYPE, sizeBytes: file.size }
      onPhase?.('uploading')
      const target = await unwrap(api.POST('/api/v1/statements/upload-url', { body: details, headers }))
      const sent = await send(target.signedUrl, { method: 'PUT', headers: { 'content-type': details.mimeType }, body: file })
      if (!sent.ok) throw new StatementUploadError(sent.status)

      onPhase?.('registering')
      const call = api.POST('/api/v1/statements', {
        body: { ...details, storagePath: target.storagePath, sha256, propertyId, sourceSystem, uploadBatchId },
        headers,
      })
      // An identical file on record is a 409 naming that statement: an outcome to link to, not a failure.
      const answered = await call.catch(() => null)
      if (answered && answered.response.status === 409 && isDuplicateBody(answered.error)) {
        return { outcome: 'identical', existingStatementId: answered.error.duplicate.existingStatementId, message: answered.error.duplicate.description }
      }
      const registered = await unwrap(answered ? Promise.resolve(answered) : call)
      const statement: Statement = registered.statement
      return {
        outcome: 'registered',
        statement,
        processingQueued: registered.processingJobId !== null,
        likelyDuplicate: registered.duplicate,
      }
    },

    async getExtraction(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const extraction: StatementExtraction = await unwrap(
          api.GET('/api/v1/statements/{statementId}/extraction', {
            params: { path: { statementId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return extraction
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },

    async downloadUrl(companyId, id) {
      const link = await unwrap(
        api.GET('/api/v1/statements/{statementId}/download-url', {
          params: { path: { statementId: id } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return link.url
    },

    async correctField(companyId, id, field, value) {
      const extraction: StatementExtraction = await unwrap(
        api.PUT('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/correction', {
          params: { path: { statementId: id, fieldName: field } },
          body: { value },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return extraction
    },

    async confirmField(companyId, id, field) {
      const extraction: StatementExtraction = await unwrap(
        api.POST('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/confirm', {
          params: { path: { statementId: id, fieldName: field } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return extraction
    },

    async confirmNotOnStatement(companyId, id, field) {
      const extraction: StatementExtraction = await unwrap(
        api.POST('/api/v1/statements/{statementId}/extraction/fields/{fieldName}/not-on-statement', {
          params: { path: { statementId: id, fieldName: field } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return extraction
    },

    async setMatch(companyId, id, match) {
      const statement: Statement = await unwrap(
        api.PUT('/api/v1/statements/{statementId}/match', {
          params: { path: { statementId: id } },
          body: match,
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return statement
    },

    async verify(companyId, id) {
      return unwrap(
        api.POST('/api/v1/statements/{statementId}/verify', {
          params: { path: { statementId: id } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
    },

    verifyMany(companyId, ids) {
      return unwrap(api.POST('/api/v1/statements/verify', { body: { statementIds: [...ids] }, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },

    async reject(companyId, id, reason) {
      const statement: Statement = await unwrap(
        api.POST('/api/v1/statements/{statementId}/reject', {
          params: { path: { statementId: id } },
          body: { reason },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return statement
    },

    async markDuplicate(companyId, id, duplicateOfStatementId) {
      const statement: Statement = await unwrap(
        api.POST('/api/v1/statements/{statementId}/mark-duplicate', {
          params: { path: { statementId: id } },
          body: { duplicateOfStatementId },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return statement
    },
  }
}
