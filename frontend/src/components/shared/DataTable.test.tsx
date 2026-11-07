import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DataTable } from './DataTable'
import type { DataTableColumn } from './DataTable'

interface Row {
  id: string
  name: string
  rent: number
}

const rows: Row[] = [
  { id: 'a', name: 'Alpha Traders', rent: 1000 },
  { id: 'b', name: 'Beta Foods', rent: 2000 },
]

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Tenant', cell: (r) => r.name, sortable: true },
  { id: 'rent', header: 'Rent', cell: (r) => String(r.rent), align: 'right' },
]

describe('DataTable', () => {
  it('renders rows and an sr-only caption', () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="Tenants" />)
    const table = screen.getByRole('table', { name: 'Tenants' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('Alpha Traders')).toBeInTheDocument()
  })

  it('renders the default and custom empty state', () => {
    const { rerender } = render(<DataTable columns={columns} rows={[]} getRowId={(r) => r.id} caption="Tenants" />)
    expect(screen.getByText('No records yet')).toBeInTheDocument()
    rerender(
      <DataTable columns={columns} rows={[]} getRowId={(r) => r.id} caption="Tenants" emptyState={<p>Nothing here</p>} />,
    )
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('renders a loading status instead of rows', () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="Tenants" isLoading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading records…')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders an error with retry', async () => {
    const onRetry = vi.fn()
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="Tenants" error="Boom" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Boom')
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('toggles sort direction via onSortChange and sets aria-sort', async () => {
    const onSortChange = vi.fn()
    const { rerender } = render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="Tenants" onSortChange={onSortChange} />,
    )
    const header = screen.getByRole('columnheader', { name: /tenant/i })
    expect(header).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(screen.getByRole('button', { name: /tenant/i }))
    expect(onSortChange).toHaveBeenLastCalledWith({ field: 'name', direction: 'asc' })

    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        caption="Tenants"
        sort={{ field: 'name', direction: 'asc' }}
        onSortChange={onSortChange}
      />,
    )
    expect(screen.getByRole('columnheader', { name: /tenant/i })).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(screen.getByRole('button', { name: /tenant/i }))
    expect(onSortChange).toHaveBeenLastCalledWith({ field: 'name', direction: 'desc' })
    // Non-sortable column has no sort button.
    expect(screen.queryByRole('button', { name: /rent/i })).not.toBeInTheDocument()
  })

  it('calls onRowClick on click and Enter', async () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} caption="Tenants" onRowClick={onRowClick} />)
    const row = screen.getByText('Beta Foods').closest('tr')
    expect(row).not.toBeNull()
    await userEvent.click(row as HTMLElement)
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1])
    ;(row as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenCalledTimes(2)
  })

  it('supports row selection', async () => {
    const onSelectionChange = vi.fn()
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        caption="Tenants"
        selectable
        selectedIds={[]}
        onSelectionChange={onSelectionChange}
        onRowClick={() => {
          throw new Error('row click should not fire from checkbox')
        }}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a'])
    await userEvent.click(screen.getByRole('checkbox', { name: /select all/i }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a', 'b'])
  })
})
