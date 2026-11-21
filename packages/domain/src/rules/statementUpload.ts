import type { DuplicateCandidate } from './statementDuplicates.js'
import { detectDuplicatesInBatch } from './statementDuplicates.js'

/** A statement upload is a PDF: the document-processing service reads nothing else. */
export const STATEMENT_UPLOAD_MIME_TYPE = 'application/pdf' as const

/** Largest statement file accepted, in bytes (the statements bucket's limit; the API's limit is the same by default). */
export const STATEMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024

/** Every PDF starts with these bytes, whatever its name or reported type. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const // "%PDF-"

/** How many leading bytes `statementFileProblem` needs to recognise a PDF. */
export const PDF_SIGNATURE_LENGTH = PDF_SIGNATURE.length

export type StatementFileProblemReason = 'empty' | 'too_large' | 'not_pdf'

export interface StatementFileProblem {
  reason: StatementFileProblemReason
  message: string
}

export interface StatementFileFacts {
  sizeBytes: number
  /** The file's first bytes (at least PDF_SIGNATURE_LENGTH when the file is that long). */
  head: Uint8Array
  /** Upper limit to apply; defaults to STATEMENT_UPLOAD_MAX_BYTES. */
  maxBytes?: number
}

/**
 * Why a file cannot be uploaded as a statement, or null when it can: it must be non-empty, within the size limit and
 * actually a PDF (checked by its content, not by its name or the browser's reported type).
 */
export function statementFileProblem({ sizeBytes, head, maxBytes = STATEMENT_UPLOAD_MAX_BYTES }: StatementFileFacts): StatementFileProblem | null {
  if (sizeBytes <= 0) return { reason: 'empty', message: 'The file is empty.' }
  if (sizeBytes > maxBytes) {
    return { reason: 'too_large', message: `The file is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB limit for statements.` }
  }
  if (!PDF_SIGNATURE.every((byte, index) => head[index] === byte)) {
    return { reason: 'not_pdf', message: 'The file is not a PDF. Export the statement from the accounting system as a PDF.' }
  }
  return null
}

/** A file of one upload batch that repeats an earlier file of the same batch. */
export interface BatchRepeat {
  /** Index of the repeating file in the batch. */
  index: number
  /** Index of the earlier file it repeats. */
  repeatsIndex: number
}

/**
 * Files of one upload batch that repeat an earlier file of the same batch (identical content, by SHA-256), using the
 * same duplicate rule as the API. Only the first copy is uploaded; each repeat is reported against it. Duplicates of
 * statements already on record are found by the API when each file is registered.
 */
export function repeatsWithinBatch(files: readonly Pick<DuplicateCandidate, 'file'>[]): BatchRepeat[] {
  // Batch items carry the synthetic id `batch:<index>`, so the match names the earlier file's index.
  return detectDuplicatesInBatch(files.map(({ file }) => ({ file }))).map(({ index, match }) => ({
    index,
    repeatsIndex: Number(match.existingStatementId.slice('batch:'.length)),
  }))
}
