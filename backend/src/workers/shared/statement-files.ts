import { Inject, Injectable } from '@nestjs/common'
import type { EntityId } from '@leaseguard/domain'

import type { WorkerEnv } from '../../config/env'
import { WORKER_ENV } from '../../config/tokens'
import { ServiceRoleClientFactory } from '../../infrastructure/database/service-role-client.factory'
import { parseStorageObjectPath } from '../../infrastructure/storage/storage-paths'

/** A file could not be downloaded from storage. Retryable unless the storage API answered with a 4xx. */
export class StorageDownloadError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'StorageDownloadError'
    this.retryable = retryable
  }
}

/** Downloads one stored file of a company. */
export interface CompanyFileStore {
  download(companyId: EntityId, storagePath: string): Promise<Blob>
}

/**
 * Files in the private statements bucket (SUPABASE_STATEMENTS_BUCKET), read with the service role, so
 * storage policies do not apply and this class is the only guard. The path must follow the storage
 * convention exactly (`<company_id>/<entity_id>/<file>`, parsed strictly by `parseStorageObjectPath`)
 * and name the job's company. A prefix check is not enough: storage-js does not encode the path, so a
 * row holding `<A>/../<B>/...` would be resolved by URL parsing to company B's object.
 */
@Injectable()
export class StatementFiles implements CompanyFileStore {
  constructor(
    private readonly clients: ServiceRoleClientFactory,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {}

  async download(companyId: EntityId, storagePath: string): Promise<Blob> {
    const location = parseStorageObjectPath(storagePath)
    if (!location || location.companyId !== companyId.toLowerCase()) {
      throw new StorageDownloadError(`Storage path is not a file of company ${companyId}`, false)
    }
    const { data, error } = await this.clients.get().storage.from(this.env.SUPABASE_STATEMENTS_BUCKET).download(storagePath)
    if (error) {
      const status = error.status
      const retryable = status === undefined || status === 408 || status === 429 || status >= 500
      throw new StorageDownloadError(
        `Could not download the file from storage${status ? ` (HTTP ${status})` : ''}: ${error.message}`,
        retryable,
      )
    }
    return data
  }
}
