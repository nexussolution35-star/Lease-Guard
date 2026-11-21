import { parseGoogleSheetsLink, type EntityId, type PortfolioImport, type PortfolioImportScope } from '@leaseguard/domain'
import { isApiError } from '@leaseguard/api-client'
import { Sheet } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeApiError } from '@/lib/data/apiErrors'

import { useImportGoogleSheet } from '../api/queries'

export interface GoogleSheetLinkFormProps {
  scope: PortfolioImportScope
  /** The property the units are for, when `scope` is `units`. */
  propertyId?: EntityId | undefined
  /** While a file is being uploaded. */
  disabled?: boolean
  onImported: (batch: PortfolioImport) => void
}

/** Statuses whose message the API writes for the person (size limit, Google unreachable or too slow). */
const SHEET_STATUSES: ReadonlySet<number> = new Set([413, 502, 504])

/**
 * The other way into an import: paste a Google Sheets link instead of choosing a file. One input and one action; the
 * API reads the sheet (the tab in the link, or the first tab) and keeps a copy with the import.
 */
export function GoogleSheetLinkForm({ scope, propertyId, disabled = false, onImported }: GoogleSheetLinkFormProps) {
  const importSheet = useImportGoogleSheet()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | undefined>()
  const id = useId()
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (parseGoogleSheetsLink(url) === null) {
      setError(
        url.trim() === ''
          ? 'Paste the link of the Google Sheet.'
          : 'This is not a Google Sheets link. Open the sheet in Google Sheets and copy the link from the address bar.',
      )
      return
    }
    setError(undefined)
    try {
      onImported(await importSheet.mutateAsync({ url: url.trim(), scope, ...(propertyId ? { propertyId } : {}) }))
    } catch (failure) {
      setError(sheetErrorMessage(failure))
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} aria-label="Google Sheet" className="grid gap-1.5">
      <Label htmlFor={`${id}-url`}>Google Sheets link</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            setError(undefined)
          }}
          disabled={disabled || importSheet.isPending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="outline" disabled={disabled || importSheet.isPending}>
          <Sheet aria-hidden="true" />
          {importSheet.isPending ? 'Reading the sheet…' : 'Read sheet'}
        </Button>
      </div>
      <p id={descriptionId} className="text-xs text-muted-foreground italic">
        Share the sheet with &ldquo;Anyone with the link&rdquo; first. LeaseGuard reads the tab in the link, or the first tab,
        and keeps a copy with the import.
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}

/** The API's message says what to do: share the sheet, fix the link, split it, or try again. */
function sheetErrorMessage(failure: unknown): string {
  if (isApiError(failure) && SHEET_STATUSES.has(failure.status) && failure.messages.length > 0) return failure.messages.join('. ')
  return describeApiError(failure, 'The sheet could not be read. Try again in a moment.')
}
