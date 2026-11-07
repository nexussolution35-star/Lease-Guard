import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DataTablePagination } from './DataTablePagination'

describe('DataTablePagination', () => {
  it('shows the range text', () => {
    render(<DataTablePagination page={2} pageSize={10} total={57} onPageChange={() => {}} />)
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 11–20 of 57')
    expect(screen.getByText('Page 2 of 6')).toBeInTheDocument()
  })

  it('disables previous on the first page and next on the last page', async () => {
    const onPageChange = vi.fn()
    const { rerender } = render(<DataTablePagination page={1} pageSize={10} total={57} onPageChange={onPageChange} />)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)

    rerender(<DataTablePagination page={6} pageSize={10} total={57} onPageChange={onPageChange} />)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 51–57 of 57')
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled()
  })

  it('handles an empty result set', () => {
    render(<DataTablePagination page={1} pageSize={10} total={0} onPageChange={() => {}} />)
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })
})
