import {
  DOCUMENT_PROCESSING_ERROR_CODES,
  EXTRACTION_FIELD_NAMES,
  EXTRACTION_ISSUE_CODES,
  EXTRACTION_ISSUE_SEVERITIES,
  EXTRACTION_RESULT_STATUSES,
  LINE_ITEM_CATEGORIES,
  LINE_ITEM_KINDS,
  type DocumentExtractionResult,
  type DocumentProcessingErrorResponse,
} from '@leaseguard/domain'
import { z } from 'zod'

/**
 * Runtime validation of the document-processing wire contract. The TypeScript contract is
 * `DocumentExtractionResult` in @leaseguard/domain; `satisfies` keeps these schemas in step with it.
 * Unknown extra keys are ignored (forward compatible); missing or mistyped keys reject the response.
 */

const confidence = z.number().min(0).max(1)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/** Rands as a decimal string with two decimals, e.g. "35000.00" (ZarDecimal). */
const zarDecimal = z.string().regex(/^-?\d{1,13}\.\d{2}$/)

export const documentExtractionResultSchema = z.object({
  engine: z.string().min(1),
  engineVersion: z.string(),
  pageCount: z.number().int().nonnegative(),
  textLayer: z.boolean(),
  ocrUsed: z.boolean(),
  openingBalance: zarDecimal.nullable(),
  fields: z.array(
    z.object({
      name: z.enum(EXTRACTION_FIELD_NAMES),
      rawText: z.string(),
      value: z.string().nullable(),
      confidence,
      flagged: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
  lineItems: z.array(
    z.object({
      date: isoDate,
      description: z.string(),
      category: z.enum(LINE_ITEM_CATEGORIES),
      kind: z.enum(LINE_ITEM_KINDS),
      amount: zarDecimal,
      confidence,
      flagged: z.boolean(),
    }),
  ),
  overallConfidence: confidence,
  issues: z.array(
    z.object({
      code: z.enum(EXTRACTION_ISSUE_CODES),
      severity: z.enum(EXTRACTION_ISSUE_SEVERITIES),
      message: z.string(),
      field: z.enum(EXTRACTION_FIELD_NAMES).nullable(),
    }),
  ),
  status: z.enum(EXTRACTION_RESULT_STATUSES),
}) satisfies z.ZodType<DocumentExtractionResult>

export const documentProcessingErrorSchema = z.object({
  code: z.enum(DOCUMENT_PROCESSING_ERROR_CODES),
  message: z.string(),
  errors: z.array(z.record(z.string(), z.unknown())).nullable(),
}) satisfies z.ZodType<DocumentProcessingErrorResponse>
