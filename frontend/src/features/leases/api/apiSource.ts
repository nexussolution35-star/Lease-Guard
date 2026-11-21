import { COMPANY_ID_HEADER, compactQuery, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { Lease, LeaseDocument, LeaseListItem } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import { listSearchTerm } from '@/lib/data/listParams'

import type { LeaseSource } from './source'

/** Thrown when the file could not be sent to storage after the API signed the upload. */
export class LeaseDocumentUploadError extends Error {
  constructor(status: number) {
    super(`The file could not be uploaded (storage answered ${status}). Try again.`)
    this.name = 'LeaseDocumentUploadError'
  }
}

/**
 * Leases from the LeaseGuard API: list and read (`GET /api/v1/leases`, `GET /api/v1/leases/{leaseId}`), create and edit
 * (`POST /api/v1/leases`, `PATCH /api/v1/leases/{leaseId}`), verification
 * (`POST /api/v1/leases/{leaseId}/verify`) and the lease's documents (`/api/v1/leases/{leaseId}/documents…`: list, signed
 * upload, record, short-lived download link). A document's file goes straight to storage with the signed URL the API
 * returns (`upload` is the browser's fetch, replaceable in tests).
 */
export function createApiLeaseSource(api: ApiClient, upload: typeof fetch = (...args) => globalThis.fetch(...args)): LeaseSource {
  return {
    async list(companyId, params) {
      const page = await unwrap(
        api.GET('/api/v1/leases', {
          params: {
            query: compactQuery({
              page: params.page,
              pageSize: params.pageSize,
              search: listSearchTerm(params.search),
              sort: params.sort,
              direction: params.direction,
              status: params.status,
              propertyId: params.propertyId,
              unitId: params.unitId,
              tenantId: params.tenantId,
              verified: params.verified,
              expiresWithinDays: params.expiresWithinDays,
            }),
          },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return { ...page, items: page.items satisfies LeaseListItem[] }
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const lease: Lease = await unwrap(
          api.GET('/api/v1/leases/{leaseId}', {
            params: { path: { leaseId: id } },
            headers: { [COMPANY_ID_HEADER]: companyId },
          }),
        )
        return lease
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },

    create(companyId, lease) {
      return unwrap(api.POST('/api/v1/leases', { body: lease, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },

    update(companyId, id, changes) {
      return unwrap(
        api.PATCH('/api/v1/leases/{leaseId}', { params: { path: { leaseId: id } }, body: changes, headers: { [COMPANY_ID_HEADER]: companyId } }),
      )
    },

    verify(companyId, id) {
      return unwrap(api.POST('/api/v1/leases/{leaseId}/verify', { params: { path: { leaseId: id } }, headers: { [COMPANY_ID_HEADER]: companyId } }))
    },

    async listDocuments(companyId, leaseId) {
      const documents: LeaseDocument[] = await unwrap(
        api.GET('/api/v1/leases/{leaseId}/documents', { params: { path: { leaseId } }, headers: { [COMPANY_ID_HEADER]: companyId } }),
      )
      return documents
    },

    async uploadDocument(companyId, leaseId, { file, documentType, title }) {
      const headers = { [COMPANY_ID_HEADER]: companyId }
      const params = { path: { leaseId } }
      const details = { fileName: file.name, mimeType: 'application/pdf' as const, sizeBytes: file.size }
      const target = await unwrap(api.POST('/api/v1/leases/{leaseId}/documents/upload-url', { params, body: details, headers }))
      const sent = await upload(target.signedUrl, { method: 'PUT', headers: { 'content-type': details.mimeType }, body: file })
      if (!sent.ok) throw new LeaseDocumentUploadError(sent.status)
      const document: LeaseDocument = await unwrap(
        api.POST('/api/v1/leases/{leaseId}/documents', {
          params,
          body: { ...details, storagePath: target.storagePath, documentType, title },
          headers,
        }),
      )
      return document
    },

    async documentDownloadUrl(companyId, leaseId, documentId) {
      const link = await unwrap(
        api.GET('/api/v1/leases/{leaseId}/documents/{documentId}/download-url', {
          params: { path: { leaseId, documentId } },
          headers: { [COMPANY_ID_HEADER]: companyId },
        }),
      )
      return link.url
    },
  }
}
