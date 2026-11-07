import { ExternalLink, FileImage, FileText, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { StoredFile } from '@leaseguard/domain'

export interface FileAttachmentProps {
  file: StoredFile
  onOpen?: () => void
  onRemove?: () => void
  /** Single-line, smaller variant. */
  compact?: boolean
  className?: string
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0).replace('.', ',')} ${units[unit]}`
}

function typeLabel(mimeType: StoredFile['mimeType']): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'PDF'
    case 'image/png':
      return 'PNG'
    case 'image/jpeg':
      return 'JPEG'
  }
}

export function FileAttachment({ file, onOpen, onRemove, compact = false, className }: FileAttachmentProps) {
  const Icon = file.mimeType === 'application/pdf' ? FileText : FileImage
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card text-card-foreground',
        compact ? 'px-2 py-1.5' : 'p-3',
        className,
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive',
          compact ? 'size-7' : 'size-9',
          file.mimeType !== 'application/pdf' && 'bg-info/10 text-info',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={file.fileName}>
          {file.fileName}
        </p>
        {!compact ? (
          <p className="text-xs text-muted-foreground">
            {typeLabel(file.mimeType)} · {formatBytes(file.sizeBytes)}
          </p>
        ) : null}
      </div>
      {compact ? <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</span> : null}
      {onOpen ? (
        <Button type="button" variant="ghost" size="icon-sm" onClick={onOpen} aria-label={`Open ${file.fileName}`}>
          <ExternalLink aria-hidden="true" />
        </Button>
      ) : null}
      {onRemove ? (
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${file.fileName}`}>
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}
