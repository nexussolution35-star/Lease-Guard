import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { isAwaitingWorkspace } from '@/lib/data/queries'

import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'
import { NoActiveWorkspace } from './NoActiveWorkspace'

export interface RecordQueryViewProps<T> {
  /** A detail query whose data is null when the record does not exist in the active workspace. */
  query: UseQueryResult<T | null>
  /** Rendered when the record does not exist (typically `RecordNotFound`). */
  notFound: ReactNode
  /** Screen-reader label while loading. */
  loadingLabel?: string
  children: (record: T) => ReactNode
}

/** Loading, error, no-workspace and not-found states for one record; renders `children` with the record. */
export function RecordQueryView<T>({ query, notFound, loadingLabel = 'Loading record…', children }: RecordQueryViewProps<T>) {
  if (isAwaitingWorkspace(query)) return <NoActiveWorkspace />
  switch (query.status) {
    case 'pending':
      return <LoadingState label={loadingLabel} rows={4} />
    case 'error':
      return <ErrorState title="Could not load this record" error={query.error} onRetry={() => void query.refetch()} />
    case 'success':
      return query.data === null ? notFound : children(query.data)
  }
}
