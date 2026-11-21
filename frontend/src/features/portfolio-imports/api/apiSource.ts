import { COMPANY_ID_HEADER, isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'
import type { PortfolioImport } from '@leaseguard/domain'

import { isUuid } from '@/lib/data/ids'
import type { Page } from '@/lib/data/listParams'

import type { PortfolioImportSource } from './source'

/** Thrown when the file could not be sent to storage after the API signed the upload. */
export class PortfolioUploadError extends Error {
  constructor(status: number) {
    super(`The file could not be uploaded (storage answered ${status}). Try again.`)
    this.name = 'PortfolioUploadError'
  }
}

/**
 * Portfolio import batches from the LeaseGuard API (`/api/v1/portfolio-imports…`). The file goes straight to storage
 * with the signed URL the API returns (`upload` is the browser's fetch, replaceable in tests); the API then reads it.
 */
export function createApiPortfolioImportSource(api: ApiClient, upload: typeof fetch = (...args) => globalThis.fetch(...args)): PortfolioImportSource {
  const scoped = (companyId: string) => ({ [COMPANY_ID_HEADER]: companyId })
  return {
    async list(companyId, { page, pageSize, scope, propertyId }) {
      const batches: Page<PortfolioImport> = await unwrap(
        api.GET('/api/v1/portfolio-imports', {
          params: { query: { page, pageSize, ...(scope ? { scope } : {}), ...(propertyId ? { propertyId } : {}) } },
          headers: scoped(companyId),
        }),
      )
      return batches
    },

    async upload(companyId, { file, scope, propertyId }) {
      const details = { fileName: file.name, sizeBytes: file.size }
      const target = await unwrap(api.POST('/api/v1/portfolio-imports/upload-url', { body: details, headers: scoped(companyId) }))
      const sent = await upload(target.signedUrl, { method: 'PUT', headers: { 'content-type': target.contentType }, body: file })
      if (!sent.ok) throw new PortfolioUploadError(sent.status)
      const batch: PortfolioImport = await unwrap(
        api.POST('/api/v1/portfolio-imports', {
          body: { ...details, scope, storagePath: target.storagePath, ...(propertyId ? { propertyId } : {}) },
          headers: scoped(companyId),
        }),
      )
      return batch
    },

    async importGoogleSheet(companyId, { url, scope, propertyId }) {
      const batch: PortfolioImport = await unwrap(
        api.POST('/api/v1/portfolio-imports/google-sheets', {
          body: { url, scope, ...(propertyId ? { propertyId } : {}) },
          headers: scoped(companyId),
        }),
      )
      return batch
    },

    async get(companyId, id) {
      if (!isUuid(id)) return null
      try {
        const batch: PortfolioImport = await unwrap(
          api.GET('/api/v1/portfolio-imports/{importId}', { params: { path: { importId: id } }, headers: scoped(companyId) }),
        )
        return batch
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },

    async selectSheet(companyId, id, sheetName) {
      const batch: PortfolioImport = await unwrap(
        api.POST('/api/v1/portfolio-imports/{importId}/sheet', { params: { path: { importId: id } }, body: { sheetName }, headers: scoped(companyId) }),
      )
      return batch
    },
  }
}
