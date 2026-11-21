import type { EntityId, PortfolioImport, PortfolioImportScope } from '@leaseguard/domain'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { DataTable, DateDisplay, SectionHeader, SignOff, type DataTableColumn } from '@/components/shared'
import { useMemberList } from '@/features/users/api/queries'
import { MAX_LIST_PAGE_SIZE } from '@/lib/data/listParams'

import { usePortfolioImportList } from '../api/queries'

const PAGE_SIZE = 10
const COUNT_FORMAT = new Intl.NumberFormat('en-ZA')

/**
 * The workspace's earlier imports, newest first: a batch left with rows to fix is opened again from here. For a units
 * import, only that property's imports are listed.
 */
export function ImportHistory({ scope, propertyId }: { scope: PortfolioImportScope; propertyId?: EntityId | undefined }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const history = usePortfolioImportList({ page, pageSize, scope, ...(propertyId ? { propertyId } : {}) })
  const members = useMemberList({ page: 1, pageSize: MAX_LIST_PAGE_SIZE, sort: 'fullName', direction: 'asc' })
  const memberName = (userId: EntityId | undefined) =>
    userId ? members.data?.items.find((member) => member.id.toLowerCase() === userId.toLowerCase())?.fullName : undefined

  const columns: DataTableColumn<PortfolioImport>[] = [
    {
      id: 'file',
      header: 'File',
      cell: (batch) => (
        <Link to="/properties/import" search={{ importId: batch.id }} className="font-medium hover:underline">
          {batch.fileName}
        </Link>
      ),
    },
    {
      id: 'rows',
      header: 'Rows',
      align: 'right',
      className: 'w-20',
      cell: (batch) => <span className="tabular-nums">{COUNT_FORMAT.format(batch.rowCount)}</span>,
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      hideBelow: 'sm',
      cell: (batch) => {
        const name = memberName(batch.uploadedByUserId)
        return name ? <SignOff by={name} at={batch.uploadedAt} /> : <DateDisplay value={batch.uploadedAt} className="text-sm tabular-nums" />
      },
    },
  ]

  return (
    <section aria-label="Earlier imports" className="space-y-3">
      <SectionHeader title="Earlier imports" description="Open an import to carry on checking and fixing its rows." />
      <DataTable
        caption="Earlier imports, newest first"
        columns={columns}
        rows={history.data?.items ?? []}
        getRowId={(batch) => batch.id}
        isLoading={history.isPending}
        error={history.isError ? history.error : null}
        onRetry={() => void history.refetch()}
        emptyState={<p className="px-3 py-8 text-center text-sm text-muted-foreground">No files have been imported here yet.</p>}
        {...(history.data && history.data.total > pageSize
          ? {
              pagination: {
                page,
                pageSize,
                total: history.data.total,
                onPageChange: setPage,
                onPageSizeChange: (size: number) => {
                  setPageSize(size)
                  setPage(1)
                },
              },
            }
          : {})}
      />
    </section>
  )
}
