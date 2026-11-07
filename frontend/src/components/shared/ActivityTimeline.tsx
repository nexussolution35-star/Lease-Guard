import {
  Archive,
  CheckCircle2,
  Eye,
  FilePlus2,
  LogIn,
  LogOut,
  Pencil,
  RefreshCcw,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
  ArrowLeftRight,
  Ban,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { labelFor } from '@/lib/labels'
import type { Tone } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { AuditAction, AuditLog, AuditScalar } from '@leaseguard/domain'

import { ActivityTimelineItem } from './ActivityTimelineItem'
import type { ActivityTimelineEntry } from './ActivityTimelineItem'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'

export type { ActivityTimelineEntry } from './ActivityTimelineItem'

export interface ActivityTimelineProps {
  items: ActivityTimelineEntry[]
  isLoading?: boolean
  error?: Error | string | null
  onRetry?: () => void
  /** Default `No activity yet`. */
  emptyLabel?: string
  /** Accessible name for the list. Default `Activity`. */
  label?: string
  className?: string
}

export function ActivityTimeline({
  items,
  isLoading = false,
  error,
  onRetry,
  emptyLabel = 'No activity yet',
  label = 'Activity',
  className,
}: ActivityTimelineProps) {
  if (isLoading) return <LoadingState label="Loading activity…" className={className} />
  if (error) return <ErrorState title="Could not load activity" error={error} onRetry={onRetry} className={className} />
  if (items.length === 0) return <EmptyState title={emptyLabel} className={className} />
  return (
    <ol aria-label={label} className={cn('flex flex-col', className)}>
      {items.map((entry) => (
        <ActivityTimelineItem key={entry.id} entry={entry} className="group/timeline-item" />
      ))}
    </ol>
  )
}

const ACTION_PRESENTATION: Readonly<Record<AuditAction, { tone: Tone; icon: LucideIcon }>> = {
  create: { tone: 'primary', icon: FilePlus2 },
  update: { tone: 'info', icon: Pencil },
  archive: { tone: 'neutral', icon: Archive },
  delete: { tone: 'danger', icon: Trash2 },
  verify: { tone: 'success', icon: ShieldCheck },
  approve: { tone: 'success', icon: CheckCircle2 },
  reject: { tone: 'danger', icon: XCircle },
  upload: { tone: 'info', icon: Upload },
  send: { tone: 'info', icon: Send },
  resolve: { tone: 'success', icon: CheckCircle2 },
  dismiss: { tone: 'neutral', icon: Ban },
  login: { tone: 'neutral', icon: LogIn },
  logout: { tone: 'neutral', icon: LogOut },
  workspace_switch: { tone: 'neutral', icon: ArrowLeftRight },
  reset_demo_data: { tone: 'warning', icon: RefreshCcw },
}

function scalarText(value: AuditScalar): string {
  if (value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/** Map an audit log record to a timeline entry (presentation only). */
// oxlint-disable-next-line react/only-export-components
export function auditLogToTimelineEntry(log: AuditLog, actorName?: string): ActivityTimelineEntry {
  const presentation = ACTION_PRESENTATION[log.action] ?? { tone: 'neutral' as Tone, icon: Eye }
  const description =
    log.changes && log.changes.length > 0
      ? log.changes
          .map((change) => `${labelFor(change.field)}: ${scalarText(change.before)} → ${scalarText(change.after)}`)
          .join('; ')
      : undefined
  return {
    id: log.id,
    title: log.summary,
    description,
    at: log.occurredAt,
    actor: actorName,
    tone: presentation.tone,
    icon: presentation.icon,
  }
}
