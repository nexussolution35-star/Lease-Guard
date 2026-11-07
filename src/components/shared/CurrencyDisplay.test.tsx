import { render, screen } from '@testing-library/react'

import { formatZAR } from '@/domain'

import { CurrencyDisplay } from './CurrencyDisplay'

describe('CurrencyDisplay', () => {
  it('formats exactly as formatZAR inside a <data> element', () => {
    const { container } = render(<CurrencyDisplay amount={37800} />)
    const el = container.querySelector('data')
    expect(el).not.toBeNull()
    expect(el).toHaveTextContent(formatZAR(37800))
    expect(el?.textContent).toBe('R 37 800,00')
    expect(el).toHaveAttribute('value', '37800')
    expect(el).toHaveClass('tabular-nums')
  })

  it('renders an em dash for null and undefined', () => {
    const { rerender } = render(<CurrencyDisplay amount={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    rerender(<CurrencyDisplay amount={undefined} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('colours negative amounts destructive with tone auto, not with tone none', () => {
    const { container, rerender } = render(<CurrencyDisplay amount={-1200} />)
    const el = container.querySelector('data')
    expect(el?.textContent).toBe(formatZAR(-1200))
    expect(el).toHaveClass('text-destructive')
    rerender(<CurrencyDisplay amount={-1200} tone="none" />)
    expect(container.querySelector('data')).not.toHaveClass('text-destructive')
    rerender(<CurrencyDisplay amount={1200} />)
    expect(container.querySelector('data')).not.toHaveClass('text-destructive')
  })

  it('shows explicit signs when signed', () => {
    const { container, rerender } = render(<CurrencyDisplay amount={500} signed />)
    expect(container.querySelector('data')?.textContent).toBe(`+${formatZAR(500)}`)
    rerender(<CurrencyDisplay amount={-500} signed />)
    expect(container.querySelector('data')?.textContent).toBe(`−${formatZAR(500)}`)
  })
})
