import type { Statement } from '@leaseguard/domain'
import { ExternalLink, FileText } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { formatBytes } from '@/components/forms'
import { ErrorState, LoadingState } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { describeApiError } from '@/lib/data/apiErrors'

import { useStatementFileLink, useStatementFileUrl } from '../../api/queries'

/** Tailwind's `md` breakpoint (48rem): from here the PDF is embedded beside the fields. */
const EMBED_QUERY = '(min-width: 48rem)'

function subscribeToEmbedQuery(onChange: () => void): () => void {
  const query = window.matchMedia(EMBED_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * Whether the screen is wide enough to embed the PDF. The embed is left out of the page below that width rather than
 * hidden with CSS: a hidden iframe still downloads the whole document, which a phone would fetch for nothing.
 */
function useEmbedsPdf(): boolean {
  return useSyncExternalStore(
    subscribeToEmbedQuery,
    () => window.matchMedia(EMBED_QUERY).matches,
    () => false,
  )
}

export interface StatementFileViewerProps {
  statement: Pick<Statement, 'id' | 'file'>
}

/**
 * The original statement, always on the screen: embedded beside the fields from `md`, and on phones (where browsers
 * do not show a PDF inside a page) a button that opens it; the embed's link is only fetched where it is shown. The file comes through a short-lived link; "Open in a new
 * tab" asks for a fresh one, so it works however long the screen has been open.
 */
export function StatementFileViewer({ statement }: StatementFileViewerProps) {
  const embeds = useEmbedsPdf()
  const embedded = useStatementFileUrl(statement.id, { enabled: embeds })
  const link = useStatementFileLink(statement.id)
  const { fileName, sizeBytes } = statement.file

  async function openInTab() {
    // Opened before the link is requested, so the browser treats it as the click's own window and does not block it.
    const tab = window.open('about:blank', '_blank')
    try {
      const url = await link.mutateAsync()
      if (tab) {
        tab.opener = null
        tab.location.href = url
      } else {
        window.location.assign(url)
      }
    } catch (error) {
      tab?.close()
      toast.error(`${fileName} could not be opened`, { description: describeApiError(error, 'Try again in a moment.') })
    }
  }

  return (
    <section aria-label="Original statement" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-medium" title={fileName}>
            {fileName}
          </span>
          <span className="shrink-0 text-muted-foreground tabular-nums">{formatBytes(sizeBytes)}</span>
        </p>
        {/* ml-auto keeps the button on the right when it wraps under a long file name. */}
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => void openInTab()} disabled={link.isPending}>
          <ExternalLink aria-hidden="true" />
          {link.isPending ? 'Opening…' : 'Open in a new tab'}
        </Button>
      </div>
      {!embeds ? null : embedded.isPending ? (
        <LoadingState label="Loading the original statement…" rows={6} />
      ) : embedded.isError ? (
        <ErrorState
          title="The original statement could not be shown"
          error={describeApiError(embedded.error, 'Try again in a moment, or open it in a new tab.')}
          onRetry={() => void embedded.refetch()}
        />
      ) : (
        <iframe
          src={embedded.data}
          title={`Original statement: ${fileName}`}
          className="h-[70vh] min-h-[28rem] w-full rounded-md border border-border bg-muted"
        />
      )}
    </section>
  )
}
