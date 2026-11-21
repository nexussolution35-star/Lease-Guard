import {
  PDF_SIGNATURE_LENGTH,
  repeatsWithinBatch,
  STATEMENT_UPLOAD_MIME_TYPE,
  statementFileProblem,
  type DuplicateMatch,
  type EntityId,
  type StatementSource as StatementSourceSystem,
} from '@leaseguard/domain'

import { describeApiError } from '@/lib/data/apiErrors'

import { StatementUploadError } from '../api/apiSource'
import type { StatementUploadInput, StatementUploadPhase, StatementUploadResult } from '../api/source'

/** Where one file of an upload batch stands. */
export type UploadFileState =
  | { phase: 'waiting' }
  | { phase: 'checking' }
  | { phase: StatementUploadPhase }
  /** Registered and queued; `processingQueued` false when the queue was down (retry it from the list). */
  | { phase: 'queued'; statementId: EntityId; processingQueued: boolean }
  /** Registered with a warning: another statement looks like the same one (same tenant, period and number). */
  | { phase: 'likely_duplicate'; statementId: EntityId; processingQueued: boolean; duplicate: DuplicateMatch }
  /** The identical file is already on record; nothing was registered. */
  | { phase: 'identical'; existingStatementId: EntityId }
  /** The same file as an earlier file of this batch, which is the only copy uploaded. */
  | { phase: 'repeat'; repeatsIndex: number }
  | { phase: 'failed'; reason: string }

export type UploadFilePhase = UploadFileState['phase']

/** Phases after which nothing more happens to the file. */
const SETTLED_PHASES: ReadonlySet<UploadFilePhase> = new Set(['queued', 'likely_duplicate', 'identical', 'repeat', 'failed'])

export function isSettled(state: UploadFileState): boolean {
  return SETTLED_PHASES.has(state.phase)
}

/** The statement a settled file now points to: its own, or the one on record it duplicates. */
export function statementOf(state: UploadFileState): EntityId | undefined {
  if (state.phase === 'queued' || state.phase === 'likely_duplicate') return state.statementId
  if (state.phase === 'identical') return state.existingStatementId
  return undefined
}

/** What a settled file came to, for the batch summary: each file counts under exactly one outcome. */
export type UploadOutcome = 'registered' | 'likely_duplicate' | 'already_uploaded' | 'failed'

/** The summary's outcomes in the order it lists them. */
export const UPLOAD_OUTCOMES: readonly UploadOutcome[] = ['registered', 'likely_duplicate', 'already_uploaded', 'failed']

/** The outcome a file counts under, or undefined while it is still under way. */
export function outcomeOf(state: UploadFileState): UploadOutcome | undefined {
  switch (state.phase) {
    case 'queued':
      return 'registered'
    case 'likely_duplicate':
      // Registered too, but counted only here: it needs checking against the other statement before it is verified.
      return 'likely_duplicate'
    case 'identical':
    case 'repeat':
      // Nothing new was registered: the file is on record already, or another copy in this upload was sent.
      return 'already_uploaded'
    case 'failed':
      return 'failed'
    default:
      return undefined
  }
}

/** How many files came to each outcome. Every settled file counts once, so the counts add up to the settled files. */
export function countOutcomes(states: readonly UploadFileState[]): Readonly<Record<UploadOutcome, number>> {
  const counts: Record<UploadOutcome, number> = { registered: 0, likely_duplicate: 0, already_uploaded: 0, failed: 0 }
  for (const state of states) {
    const outcome = outcomeOf(state)
    if (outcome) counts[outcome] += 1
  }
  return counts
}

export interface UploadBatchOptions {
  files: readonly File[]
  propertyId: EntityId
  sourceSystem: StatementSourceSystem
  uploadBatchId: string
  /** Uploads and registers one checked file (the statement data source). */
  upload: (input: StatementUploadInput, onPhase: (phase: StatementUploadPhase) => void) => Promise<StatementUploadResult>
  /** Called whenever a file's state changes, with its index in `files`. */
  onChange: (index: number, state: UploadFileState) => void
  /** Files sent at the same time. Default 3. */
  concurrency?: number
  /** SHA-256 hex digest of the bytes; default Web Crypto. */
  digest?: (bytes: ArrayBuffer) => Promise<string>
}

async function webCryptoSha256(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Why one file failed, in words. */
function failureReason(error: unknown): string {
  if (error instanceof StatementUploadError) return error.message
  return describeApiError(error, 'The file could not be uploaded. Try again in a moment.')
}

function settledState(result: StatementUploadResult): UploadFileState {
  if (result.outcome === 'identical') return { phase: 'identical', existingStatementId: result.existingStatementId }
  const { statement, processingQueued, likelyDuplicate } = result
  return likelyDuplicate
    ? { phase: 'likely_duplicate', statementId: statement.id, processingQueued, duplicate: likelyDuplicate }
    : { phase: 'queued', statementId: statement.id, processingQueued }
}

/**
 * Uploads one batch of statement PDFs for one property and source system. Every file is first checked (non-empty,
 * within the size limit, a PDF by its content) and hashed; a file that repeats an earlier file of the batch is reported
 * against it and not sent. The rest are uploaded a few at a time, each through its own signed URL and registered under
 * `uploadBatchId`. Each file settles on its own: one failure never stops the others. Resolves once every file settled.
 */
export async function runUploadBatch({
  files,
  propertyId,
  sourceSystem,
  uploadBatchId,
  upload,
  onChange,
  concurrency = 3,
  digest = webCryptoSha256,
}: UploadBatchOptions): Promise<void> {
  const hashes: (string | null)[] = []
  for (const [index, file] of files.entries()) {
    onChange(index, { phase: 'checking' })
    try {
      const bytes = await file.arrayBuffer()
      const problem = statementFileProblem({ sizeBytes: file.size, head: new Uint8Array(bytes, 0, Math.min(PDF_SIGNATURE_LENGTH, bytes.byteLength)) })
      if (problem) {
        onChange(index, { phase: 'failed', reason: problem.message })
        hashes.push(null)
        continue
      }
      hashes.push(await digest(bytes))
      onChange(index, { phase: 'waiting' })
    } catch {
      onChange(index, { phase: 'failed', reason: 'The file could not be read. Choose it again.' })
      hashes.push(null)
    }
  }

  const checked = files.flatMap((file, index) => {
    const sha256 = hashes[index]
    return sha256 ? [{ index, file, sha256 }] : []
  })
  const repeats = repeatsWithinBatch(
    checked.map(({ file, sha256 }) => ({
      file: { fileName: file.name, storagePath: '', mimeType: STATEMENT_UPLOAD_MIME_TYPE, sizeBytes: file.size, sha256 },
    })),
  )
  const repeated = new Set<number>()
  for (const repeat of repeats) {
    const item = checked[repeat.index]!
    repeated.add(item.index)
    onChange(item.index, { phase: 'repeat', repeatsIndex: checked[repeat.repeatsIndex]!.index })
  }

  const queue = checked.filter(({ index }) => !repeated.has(index))
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { index, file, sha256 } = next
      try {
        const result = await upload({ file, sha256, propertyId, sourceSystem, uploadBatchId }, (phase) => onChange(index, { phase }))
        onChange(index, settledState(result))
      } catch (error) {
        onChange(index, { phase: 'failed', reason: failureReason(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker))
}
