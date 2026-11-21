import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { EntityId, ExtractionFieldName, Statement, StatementExtraction, StatementListItem } from '@leaseguard/domain'

import type { Page } from '@/lib/data/listParams'
import { useCompanyQuery } from '@/lib/data/queries'
import { createEntityKeys } from '@/lib/data/queryKeys'
import { useActiveCompanyId } from '@/lib/data/useActiveCompanyId'
import { useActiveCompanyOrThrow } from '@/lib/data/useActiveCompanyOrThrow'

import { getStatementSource } from './selectSource'
import type {
  StatementListParams,
  StatementMatch,
  StatementProcessingRetry,
  StatementUploadInput,
  StatementUploadPhase,
  StatementUploadResult,
  StatementsVerificationResult,
  StatementVerificationResult,
} from './source'

export const statementKeys = createEntityKeys('statements')

export function useStatementList(params: StatementListParams): UseQueryResult<Page<StatementListItem>> {
  return useCompanyQuery(
    (companyId) => statementKeys.list(companyId, params),
    (companyId) => getStatementSource().list(companyId, params),
    { keepPrevious: true },
  )
}

/** Data is null when the record does not exist in the active workspace. */
export function useStatementQuery(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<Statement | null> {
  return useCompanyQuery(
    (companyId) => statementKeys.detail(companyId, id),
    (companyId) => getStatementSource().get(companyId, id),
    options,
  )
}

/**
 * Queues a statement's processing again (writers), including one whose automatic extraction failed. Refreshes
 * every statement list and detail afterwards: the statement's status and processing error change.
 */
export function useRetryStatementProcessing(): UseMutationResult<StatementProcessingRetry, Error, EntityId> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (id: EntityId) => getStatementSource().retryProcessing(companyId(), id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: statementKeys.all }),
  })
}

export interface StatementUploader {
  /** Uploads and registers one checked statement PDF in the active workspace (writers). */
  upload: (input: StatementUploadInput, onPhase: (phase: StatementUploadPhase) => void) => Promise<StatementUploadResult>
  /** Refreshes every statement list and detail; call once a batch has settled. */
  refresh: () => Promise<void>
}

/** Statement uploads for the active workspace. The batch itself is run by `runUploadBatch`. */
export function useStatementUploader(): StatementUploader {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return {
    upload: (input, onPhase) => getStatementSource().upload(companyId(), input, onPhase),
    refresh: () => queryClient.invalidateQueries({ queryKey: statementKeys.all }),
  }
}

/** A statement's latest extraction; under the statement's detail key, so refreshing the statement refreshes it too. */
export const statementExtractionKey = (companyId: EntityId, id: EntityId) => [...statementKeys.detail(companyId, id), 'extraction'] as const

/** Data is null before the statement has been extracted (or when it is not in the active workspace). */
export function useStatementExtraction(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<StatementExtraction | null> {
  return useCompanyQuery(
    (companyId) => statementExtractionKey(companyId, id),
    (companyId) => getStatementSource().getExtraction(companyId, id),
    options,
  )
}

/** A five-minute link to the statement's original file (nothing to refresh afterwards). */
export function useStatementFileLink(id: EntityId): UseMutationResult<string, Error, void> {
  const companyId = useActiveCompanyOrThrow()
  return useMutation({ mutationFn: () => getStatementSource().downloadUrl(companyId(), id) })
}

/** How long a fetched link to the original file is used: inside its five minutes, so it never expires on the screen. */
const FILE_LINK_FRESH_MS = 4 * 60 * 1000

/**
 * A link to the statement's original file for showing it on the screen (any member). Kept while the screen is open and
 * not refetched on focus, so the embedded document does not reload; a fresh link is fetched when it is shown again
 * after four minutes. Separate from the statement's own keys: refreshing the statement never reloads the document.
 */
export function useStatementFileUrl(id: EntityId, options: { enabled?: boolean } = {}): UseQueryResult<string> {
  const companyId = useActiveCompanyId()
  return useQuery({
    queryKey: ['statement-file', companyId ?? '', id],
    queryFn: () => {
      if (companyId === null) throw new Error('No workspace is selected.')
      return getStatementSource().downloadUrl(companyId, id)
    },
    enabled: companyId !== null && (options.enabled ?? true),
    staleTime: FILE_LINK_FRESH_MS,
    gcTime: FILE_LINK_FRESH_MS,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export interface StatementFieldCorrection {
  field: ExtractionFieldName
  value: string | number
}

/** Enters the correct value of one extracted field (writers); stores the returned extraction. */
export function useCorrectStatementField(id: EntityId): UseMutationResult<StatementExtraction, Error, StatementFieldCorrection> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: ({ field, value }: StatementFieldCorrection) => getStatementSource().correctField(companyId(), id, field, value),
    onSuccess: (extraction) => queryClient.setQueryData(statementExtractionKey(extraction.companyId, id), extraction),
  })
}

/** Confirms an extracted value as correct (writers); stores the returned extraction. */
export function useConfirmStatementField(id: EntityId): UseMutationResult<StatementExtraction, Error, ExtractionFieldName> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (field: ExtractionFieldName) => getStatementSource().confirmField(companyId(), id, field),
    onSuccess: (extraction) => queryClient.setQueryData(statementExtractionKey(extraction.companyId, id), extraction),
  })
}

/** Confirms that the statement does not print an optional field (the statement number; writers); stores the extraction. */
export function useConfirmStatementFieldNotOnStatement(id: EntityId): UseMutationResult<StatementExtraction, Error, ExtractionFieldName> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (field: ExtractionFieldName) => getStatementSource().confirmNotOnStatement(companyId(), id, field),
    onSuccess: (extraction) => queryClient.setQueryData(statementExtractionKey(extraction.companyId, id), extraction),
  })
}

/**
 * Sets the statement's tenant, unit and lease (writers). Stores the returned statement, then refreshes the lists, whose
 * rows name the tenant and unit.
 */
export function useSetStatementMatch(id: EntityId): UseMutationResult<Statement, Error, StatementMatch> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (match: StatementMatch) => getStatementSource().setMatch(companyId(), id, match),
    onSuccess: (statement) => queryClient.setQueryData(statementKeys.detail(statement.companyId, statement.id), statement),
    onSettled: () => queryClient.invalidateQueries({ queryKey: statementKeys.lists(companyId()) }),
  })
}

/**
 * Verifies the statement (writers). Refreshes every statement record afterwards: the statement's status, figures and
 * verifier change, its extraction closes, and the lists and arrears figures count it from now on.
 */
export function useVerifyStatement(id: EntityId): UseMutationResult<StatementVerificationResult, Error, void> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: () => getStatementSource().verify(companyId(), id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: statementKeys.all }),
  })
}

/**
 * Verifies several statements of the active workspace, each on its own (writers). Refreshes every statement record
 * afterwards, whatever the mix of verified and refused.
 */
export function useVerifyStatements(): UseMutationResult<StatementsVerificationResult, Error, readonly EntityId[]> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (ids: readonly EntityId[]) => getStatementSource().verifyMany(companyId(), ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: statementKeys.all }),
  })
}

/** Rejects the statement with a reason (writers); refreshes every statement record afterwards. */
export function useRejectStatement(id: EntityId): UseMutationResult<Statement, Error, string> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (reason: string) => getStatementSource().reject(companyId(), id, reason),
    onSettled: () => queryClient.invalidateQueries({ queryKey: statementKeys.all }),
  })
}

/** Marks the statement as a duplicate of another statement (writers); refreshes every statement record afterwards. */
export function useMarkStatementDuplicate(id: EntityId): UseMutationResult<Statement, Error, EntityId> {
  const queryClient = useQueryClient()
  const companyId = useActiveCompanyOrThrow()
  return useMutation({
    mutationFn: (duplicateOfStatementId: EntityId) => getStatementSource().markDuplicate(companyId(), id, duplicateOfStatementId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: statementKeys.all }),
  })
}
