import { describe, expect, it } from 'vitest'

import type { StoredFile } from '../types/index.js'
import { repeatsWithinBatch, STATEMENT_UPLOAD_MAX_BYTES, statementFileProblem } from './statementUpload.js'

/** ASCII text as bytes (the domain package has no TextEncoder). */
const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0))
const PDF_HEAD = bytes('%PDF-1.7')

function file(sha256: string): { file: StoredFile } {
  return { file: { fileName: `${sha256.slice(0, 4)}.pdf`, storagePath: '', mimeType: 'application/pdf', sizeBytes: 10, sha256 } }
}

describe('statementFileProblem', () => {
  it('accepts a PDF within the limit', () => {
    expect(statementFileProblem({ sizeBytes: 52_000, head: PDF_HEAD })).toBeNull()
    expect(statementFileProblem({ sizeBytes: STATEMENT_UPLOAD_MAX_BYTES, head: PDF_HEAD })).toBeNull()
  })

  it('refuses an empty file, a file over the limit and a file that is not a PDF, in that order', () => {
    expect(statementFileProblem({ sizeBytes: 0, head: new Uint8Array() })?.reason).toBe('empty')
    expect(statementFileProblem({ sizeBytes: STATEMENT_UPLOAD_MAX_BYTES + 1, head: PDF_HEAD })).toEqual({
      reason: 'too_large',
      message: 'The file is larger than the 20 MB limit for statements.',
    })
    expect(statementFileProblem({ sizeBytes: 100, head: bytes('PK\u0003\u0004') })?.reason).toBe('not_pdf')
    // A file shorter than the signature is not a PDF either.
    expect(statementFileProblem({ sizeBytes: 3, head: bytes('%PD') })?.reason).toBe('not_pdf')
  })

  it('applies a smaller limit when given', () => {
    expect(statementFileProblem({ sizeBytes: 2 * 1024 * 1024 + 1, head: PDF_HEAD, maxBytes: 2 * 1024 * 1024 })?.message).toBe(
      'The file is larger than the 2 MB limit for statements.',
    )
  })
})

describe('repeatsWithinBatch', () => {
  it('reports each repeat against the first copy of the same file', () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    expect(repeatsWithinBatch([file(a), file(b), file(a), file(a), file(b)])).toEqual([
      { index: 2, repeatsIndex: 0 },
      { index: 3, repeatsIndex: 0 },
      { index: 4, repeatsIndex: 1 },
    ])
  })

  it('finds none in a batch of different files', () => {
    expect(repeatsWithinBatch([file('a'.repeat(64)), file('b'.repeat(64))])).toEqual([])
  })
})
