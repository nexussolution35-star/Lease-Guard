import {
  canConfirmNotOnStatement,
  confirmedNotOnStatement,
  extractionFieldKind,
  fieldReviewAction,
  fieldReviewReasons,
  formatZAR,
  isFinancialExtractionField,
  type DocumentExtractionIssue,
  type ExtractedField,
  type ExtractionFieldName,
  type FieldReviewReasonKind,
} from '@leaseguard/domain'
import { Check, CircleSlash, PenLine } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { SignOff, StatusDot } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { describeApiError } from '@/lib/data/apiErrors'
import { labelFor } from '@/lib/labels'

import { useConfirmStatementField, useConfirmStatementFieldNotOnStatement } from '../../api/queries'
import { CorrectFieldDialog } from './CorrectFieldDialog'
import { useDateFormatter } from '@/lib/dateFormat'

const REASON_LABELS: Readonly<Record<FieldReviewReasonKind, string>> = {
  missing: 'Missing',
  low_confidence: 'Low confidence',
  does_not_reconcile: 'Does not reconcile',
  differs_from_typed: 'Differs from what was typed',
  other: 'Check',
}

/** A field's value as the reviewer reads it: rands, a date in the chosen display format, or the text as printed. */
function formatFieldValue(name: ExtractionFieldName, value: string | number, formatDate: (iso: string) => string): string {
  const kind = extractionFieldKind(name)
  if (kind === 'amount' && typeof value === 'number') return formatZAR(value)
  if (kind === 'date' && typeof value === 'string') return formatDate(value)
  return String(value)
}

export interface StatementFieldListProps {
  statementId: string
  fields: readonly ExtractedField[]
  issues: readonly DocumentExtractionIssue[]
  /** Writers on a statement under review confirm and correct; everyone else reads. */
  canReview: boolean
  /** A member's name, only when loaded (a sign-off never shows a placeholder as a person). */
  signerOf: (userId: string | undefined) => string | undefined
}

/**
 * Every extracted field, statement facts first and figures after: its value (the correction once entered), what the
 * statement printed, where the review stands with it as dot and text, and why it is flagged. A flagged value is
 * confirmed or corrected; a value that was not found can only be entered, except the statement number, which the
 * reviewer may confirm is not on the statement (nothing is filled in). What counts is worked out by the domain
 * rules (`fieldResolution`, `fieldReviewReasons`); the API records who did what and when.
 */
export function StatementFieldList({ statementId, fields, issues, canReview, signerOf }: StatementFieldListProps) {
  const [correcting, setCorrecting] = useState<ExtractedField | null>(null)
  const confirm = useConfirmStatementField(statementId)
  const confirmAbsent = useConfirmStatementFieldNotOnStatement(statementId)

  async function confirmField(field: ExtractedField) {
    try {
      await confirm.mutateAsync(field.name)
      toast.success(`${labelFor(field.name)} confirmed`)
    } catch (error) {
      toast.error(`${labelFor(field.name)} was not confirmed`, { description: describeApiError(error, 'Try again in a moment.') })
    }
  }

  async function confirmNotOnStatement(field: ExtractedField) {
    try {
      await confirmAbsent.mutateAsync(field.name)
      toast.success(`Recorded that the ${labelFor(field.name).toLowerCase()} is not on the statement`)
    } catch (error) {
      toast.error(`${labelFor(field.name)} was not recorded as absent`, { description: describeApiError(error, 'Try again in a moment.') })
    }
  }

  const facts = fields.filter((field) => !isFinancialExtractionField(field.name))
  const figures = fields.filter((field) => isFinancialExtractionField(field.name))

  const group = (title: string, rows: readonly ExtractedField[]) => (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="divide-y divide-border border-y border-border">
        {rows.map((field) => (
          <FieldRow
            key={field.name}
            field={field}
            issues={issues}
            canReview={canReview}
            signerOf={signerOf}
            confirming={confirm.isPending && confirm.variables === field.name}
            confirmingAbsent={confirmAbsent.isPending && confirmAbsent.variables === field.name}
            onConfirm={() => void confirmField(field)}
            onConfirmNotOnStatement={() => void confirmNotOnStatement(field)}
            onCorrect={() => setCorrecting(field)}
          />
        ))}
      </ul>
    </div>
  )

  return (
    <>
      <div className="space-y-6">
        {group('Statement', facts)}
        {group('Figures', figures)}
      </div>
      {correcting ? <CorrectFieldDialog statementId={statementId} field={correcting} onClose={() => setCorrecting(null)} /> : null}
    </>
  )
}

interface FieldRowProps {
  field: ExtractedField
  issues: readonly DocumentExtractionIssue[]
  canReview: boolean
  signerOf: (userId: string | undefined) => string | undefined
  confirming: boolean
  confirmingAbsent: boolean
  onConfirm: () => void
  onConfirmNotOnStatement: () => void
  onCorrect: () => void
}

function FieldRow({ field, issues, canReview, signerOf, confirming, confirmingAbsent, onConfirm, onConfirmNotOnStatement, onCorrect }: FieldRowProps) {
  const { date: formatDate } = useDateFormatter()
  const label = labelFor(field.name)
  const reasons = fieldReviewReasons(field, issues)
  const action = fieldReviewAction(field)
  const shown = field.correctedValue ?? field.value
  const printed = field.rawText.trim()

  return (
    <li className="grid gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]" data-field={field.name} aria-label={label}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <Resolution field={field} signerOf={signerOf} />
        </div>
        <p className="text-sm font-medium break-words tabular-nums">
          {shown === null ? (
            <span className="font-normal text-muted-foreground">{confirmedNotOnStatement(field) ? 'Not on the statement' : 'Not found'}</span>
          ) : (
            formatFieldValue(field.name, shown, formatDate)
          )}
        </p>
        {printed !== '' && (field.correctedValue !== undefined || field.value === null || action !== 'none') ? (
          <p className="text-xs text-muted-foreground break-words">
            On the statement: <span className="text-foreground">“{printed}”</span>
            {field.correctedValue !== undefined && field.value !== null ? <> · read as {formatFieldValue(field.name, field.value, formatDate)}</> : null}
          </p>
        ) : null}
        {reasons.length > 0 ? (
          <ul className="space-y-0.5" aria-label={`Why ${label.toLowerCase()} is flagged`}>
            {reasons.map((reason, index) => (
              <li key={`${reason.kind}-${index}`} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{REASON_LABELS[reason.kind]}</span> · {reason.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {canReview ? (
        // Actions sit on the right at every width, phones included.
        <div className="flex flex-wrap items-start justify-end gap-2">
          {action === 'confirm_or_correct' ? (
            <Button type="button" variant="outline" size="sm" onClick={onConfirm} disabled={confirming} aria-label={`Confirm ${label.toLowerCase()}`}>
              <Check aria-hidden="true" />
              {confirming ? 'Confirming…' : 'Confirm'}
            </Button>
          ) : null}
          {canConfirmNotOnStatement(field) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onConfirmNotOnStatement}
              disabled={confirmingAbsent}
              aria-label={`Confirm the ${label.toLowerCase()} is not on the statement`}
            >
              <CircleSlash aria-hidden="true" />
              {confirmingAbsent ? 'Recording…' : 'Not on the statement'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={action === 'none' ? 'ghost' : 'outline'}
            size="sm"
            onClick={onCorrect}
            aria-label={`${action === 'enter' ? 'Enter' : 'Correct'} ${label.toLowerCase()}`}
          >
            <PenLine aria-hidden="true" />
            {action === 'enter' ? 'Enter' : 'Correct'}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

/** Where the review stands with a field: status as dot and text, with the reviewer's sign-off once they acted. */
function Resolution({ field, signerOf }: { field: ExtractedField; signerOf: (userId: string | undefined) => string | undefined }) {
  switch (field.resolution) {
    case 'accepted':
      return <StatusDot tone="neutral">Found, not flagged</StatusDot>
    case 'confirmed': {
      const by = signerOf(field.confirmedByUserId)
      return by ? (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          Confirmed <SignOff by={by} at={field.confirmedAt} className="text-xs" />
        </span>
      ) : (
        <StatusDot tone="success">Confirmed</StatusDot>
      )
    }
    case 'corrected': {
      const by = signerOf(field.correctedByUserId)
      return by ? (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          Corrected <SignOff by={by} at={field.correctedAt} className="text-xs" />
        </span>
      ) : (
        <StatusDot tone="success">Corrected</StatusDot>
      )
    }
    case 'unresolved':
      return <StatusDot tone="warning">{field.value === null ? 'Enter it' : 'Confirm or correct'}</StatusDot>
  }
}
