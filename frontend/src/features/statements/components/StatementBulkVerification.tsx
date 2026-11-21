import { X } from 'lucide-react'

import { AppLink, StatusDot } from '@/components/shared'
import { Button } from '@/components/ui/button'

import type { StatementsVerificationResult } from '../api/source'

const statements = (count: number) => `${count} ${count === 1 ? 'statement' : 'statements'}`

export interface StatementSelectionBarProps {
  count: number
  isPending: boolean
  onVerify: () => void
  onClear: () => void
}

/** The list's one primary action while ready statements are selected: verify them together. */
export function StatementSelectionBar({ count, isPending, onVerify, onClear }: StatementSelectionBarProps) {
  return (
    <div role="region" aria-label="Selected statements" className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-2">
      <p className="text-sm text-foreground">
        <span className="tabular-nums">{statements(count)}</span> ready to verify selected
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={isPending}>
          Clear selection
        </Button>
        <Button type="button" size="sm" onClick={onVerify} disabled={isPending}>
          Verify {statements(count)}
        </Button>
      </div>
    </div>
  )
}

/**
 * What a verification of several statements did: how many were verified, and every statement that was not, by name,
 * with each reason. Kept on screen until dismissed, so the reasons can be worked through.
 */
export function StatementVerificationOutcome({ result, onDismiss }: { result: StatementsVerificationResult; onDismiss: () => void }) {
  const { verified, notVerified } = result
  const monitoringLater = verified.filter((entry) => !entry.monitoringQueued).length
  return (
    <section aria-labelledby="statement-verification-outcome" className="mb-6 border-y border-border py-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id="statement-verification-outcome" className="text-base font-medium text-foreground">
            Verification result
          </h2>
          <p className="text-sm text-muted-foreground">
            Each statement was verified and recorded on its own; one that could not be verified did not stop the others.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Dismiss the verification result" onClick={onDismiss}>
          <X aria-hidden="true" />
        </Button>
      </header>

      <div className="mt-3 flex flex-col gap-1 text-sm">
        <StatusDot tone={verified.length > 0 ? 'success' : 'neutral'}>{statements(verified.length)} verified</StatusDot>
        {notVerified.length > 0 ? <StatusDot tone="warning">{statements(notVerified.length)} not verified</StatusDot> : null}
        {monitoringLater > 0 ? (
          <p className="text-muted-foreground">
            Monitoring for {statements(monitoringLater)} could not be queued now; the daily monitoring run includes{' '}
            {monitoringLater === 1 ? 'it' : 'them'}.
          </p>
        ) : null}
      </div>

      {notVerified.length > 0 ? (
        <ul aria-label="Statements not verified" className="mt-4 divide-y divide-border border-t border-border">
          {notVerified.map((entry) => (
            <li key={entry.statementId} className="py-3">
              <p className="text-sm font-medium text-foreground">
                {entry.fileName ? (
                  <AppLink to={`/statements/${encodeURIComponent(entry.statementId)}`} className="hover:underline">
                    {entry.fileName}
                  </AppLink>
                ) : (
                  'A statement no longer in this workspace'
                )}
                {entry.statementNumber ? <span className="font-normal text-muted-foreground tabular-nums"> · No. {entry.statementNumber}</span> : null}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {entry.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
