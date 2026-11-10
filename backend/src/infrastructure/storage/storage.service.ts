import {
  ConflictException,
  ForbiddenException,
  type HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common'

import type { ApiEnv } from '../../config/env'
import { API_ENV } from '../../config/tokens'
import type { DbClient } from '../database/rls-client.factory'

const BYTES_PER_MIB = 1024 * 1024

/** The parts of a Supabase Storage error the API reacts to. */
export interface StorageErrorLike {
  message: string
  /** HTTP status of the Storage API response; absent for network failures. */
  status?: number | undefined
  /** Storage's own status code string, e.g. `"403"` for a policy denial or `"409"` for an existing object. */
  statusCode?: string | undefined
}

/** A one-time upload target for the browser (`uploadToSignedUrl(path, token, file)` or `PUT signedUrl`). */
export interface SignedUpload {
  signedUrl: string
  token: string
  path: string
}

/** Metadata of a stored object. */
export interface StoredObjectInfo {
  /** Size in bytes, when Storage reports it. */
  sizeBytes?: number
  /**
   * Media type Storage recorded for the object (the upload's Content-Type, which the bucket's
   * allowed_mime_types checked), without parameters and lower-cased; absent when Storage does not report it.
   */
  mimeType?: string
}

/** `text/plain;charset=UTF-8` -> `text/plain`; `undefined` for a missing or blank value. */
export function baseMimeType(value: string | null | undefined): string | undefined {
  const base = value?.split(';')[0]?.trim().toLowerCase()
  return base ? base : undefined
}

/**
 * Supabase Storage access for the API. Every call goes through the caller's RLS-bound client, so the
 * storage policies of supabase/migrations/*_storage.sql decide what the caller may upload or read.
 * The worker reads files with its own service-role client and does not use this service.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  get statementsBucket(): string {
    return this.env.SUPABASE_STATEMENTS_BUCKET
  }

  /** Largest accepted statement file (DOCUMENT_PROCESSING_MAX_FILE_MB) in bytes. */
  get maxStatementBytes(): number {
    return this.env.DOCUMENT_PROCESSING_MAX_FILE_MB * BYTES_PER_MIB
  }

  /** Throws 413 when a statement file is larger than the configured limit. */
  assertStatementSize(sizeBytes: number): void {
    if (sizeBytes > this.maxStatementBytes) {
      throw new PayloadTooLargeException(
        `The file is larger than the ${this.env.DOCUMENT_PROCESSING_MAX_FILE_MB} MB limit for statements`,
      )
    }
  }

  /**
   * Signed URL the caller uploads one new object to. Never overwrites an existing object. Storage
   * checks the caller's insert permission for `path` before signing.
   */
  async createSignedUploadUrl(db: DbClient, bucket: string, path: string): Promise<SignedUpload> {
    const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path, { upsert: false })
    if (error) throw httpErrorFromStorage(error, 'Create signed upload URL', this.logger)
    return { signedUrl: data.signedUrl, token: data.token, path: data.path }
  }

  /** Metadata of an object the caller may read; `null` when it does not exist (or is not visible). */
  async objectInfo(db: DbClient, bucket: string, path: string): Promise<StoredObjectInfo | null> {
    const { data, error } = await db.storage.from(bucket).info(path)
    if (error) {
      if (isNotFound(error)) return null
      throw httpErrorFromStorage(error, 'Read object info', this.logger)
    }
    const mimeType = baseMimeType(data.contentType)
    return {
      ...(typeof data.size === 'number' ? { sizeBytes: data.size } : {}),
      ...(mimeType ? { mimeType } : {}),
    }
  }

  /** A short-lived link to read an object the caller may read; `null` when it does not exist (or is not visible). */
  async createSignedDownloadUrl(db: DbClient, bucket: string, path: string, expiresInSeconds: number): Promise<string | null> {
    const { data, error } = await db.storage.from(bucket).createSignedUrl(path, expiresInSeconds)
    if (error) {
      if (isNotFound(error)) return null
      throw httpErrorFromStorage(error, 'Create signed download URL', this.logger)
    }
    return data.signedUrl
  }

  /** Removes an object the caller may delete (storage policies decide). Removing a missing object is not an error. */
  async removeObject(db: DbClient, bucket: string, path: string): Promise<void> {
    const { error } = await db.storage.from(bucket).remove([path])
    if (error && !isNotFound(error)) throw httpErrorFromStorage(error, 'Remove object', this.logger)
  }

  /**
   * The bytes of an object the caller may read; `null` when it does not exist (or is not visible).
   * Callers check the object's size first (objectInfo), so the download is bounded by their limit.
   */
  async download(db: DbClient, bucket: string, path: string): Promise<Blob | null> {
    const { data, error } = await db.storage.from(bucket).download(path)
    if (error) {
      if (isNotFound(error)) return null
      throw httpErrorFromStorage(error, 'Download object', this.logger)
    }
    return data
  }
}

function isNotFound(error: StorageErrorLike): boolean {
  return error.status === 404 || error.statusCode === '404' || error.statusCode === 'NoSuchKey'
}

/**
 * Storage error → HTTP error. Policy denials arrive as status 400 with statusCode "403" (or 403);
 * an existing object as 409. Details are logged, never returned.
 */
export function httpErrorFromStorage(error: StorageErrorLike, operation: string, logger: Logger): HttpException {
  if (error.status === 403 || error.statusCode === '403' || error.statusCode === 'AccessDenied') {
    return new ForbiddenException('You are not allowed to perform this action')
  }
  if (error.status === 409 || error.statusCode === '409' || error.statusCode === 'ResourceAlreadyExists') {
    return new ConflictException('A file already exists at this storage path')
  }
  if (error.status === undefined || error.status >= 500) {
    logger.error(`${operation} failed: storage unavailable (${error.status ?? 'network'}): ${error.message}`)
    return new ServiceUnavailableException('File storage is not available')
  }
  logger.error(`${operation} failed (${error.status}/${error.statusCode ?? ''}): ${error.message}`)
  return new InternalServerErrorException('An unexpected error occurred')
}
