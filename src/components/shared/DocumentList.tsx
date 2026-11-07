import { FileX } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { StoredFile } from '@/types'

import { EmptyState } from './EmptyState'
import { FileAttachment } from './FileAttachment'

export interface DocumentListItem {
  id: string
  title: string
  file: StoredFile
  meta?: ReactNode
}

export interface DocumentListProps {
  documents: DocumentListItem[]
  onOpen?: (id: string) => void
  onRemove?: (id: string) => void
  /** Default `No documents`. */
  emptyLabel?: string
  className?: string
}

export function DocumentList({ documents, onOpen, onRemove, emptyLabel = 'No documents', className }: DocumentListProps) {
  if (documents.length === 0) return <EmptyState icon={FileX} title={emptyLabel} className={className} />
  return (
    <ul className={cn('space-y-3', className)}>
      {documents.map((doc) => (
        <li key={doc.id} className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-medium text-foreground">{doc.title}</p>
            {doc.meta ? <div className="text-xs text-muted-foreground">{doc.meta}</div> : null}
          </div>
          <FileAttachment
            file={doc.file}
            onOpen={onOpen ? () => onOpen(doc.id) : undefined}
            onRemove={onRemove ? () => onRemove(doc.id) : undefined}
          />
        </li>
      ))}
    </ul>
  )
}
