import { act, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'

import { setDateFormatPreference } from '@/lib/dateFormat'

import { DateDisplay } from './DateDisplay'

describe('DateDisplay', () => {
  afterEach(() => setDateFormatPreference('dd-mmm-yyyy'))

  it('renders SA short format in a <time> element with dateTime', () => {
    const { container } = render(<DateDisplay value="2026-11-06" />)
    const time = container.querySelector('time')
    expect(time).toHaveTextContent('06 Nov 2026')
    expect(time).toHaveAttribute('dateTime', '2026-11-06')
  })

  it('follows the chosen display format at once, for dates and timestamps', () => {
    const { container, rerender } = render(<DateDisplay value="2026-11-06" />)
    act(() => setDateFormatPreference('d-mmmm-yyyy'))
    expect(container.querySelector('time')).toHaveTextContent('6 November 2026')
    act(() => setDateFormatPreference('yyyy-mm-dd'))
    expect(container.querySelector('time')).toHaveTextContent('2026-11-06')
    rerender(<DateDisplay value="2026-11-06T08:30:00+02:00" style="datetime" />)
    expect(container.querySelector('time')).toHaveTextContent('2026-11-06, 08:30')
    rerender(<DateDisplay value="2026-11-03" style="relative" today="2026-11-06" />)
    expect(container.querySelector('time')).toHaveAttribute('title', '2026-11-03')
  })

  it('supports the datetime style', () => {
    const { container } = render(<DateDisplay value="2026-11-06T08:30:00+02:00" style="datetime" />)
    const time = container.querySelector('time')
    expect(time).toHaveTextContent('06 Nov 2026, 08:30')
    expect(time).toHaveAttribute('dateTime', '2026-11-06T08:30:00+02:00')
  })

  it('formats the date part of a timestamp for date-only styles', () => {
    const { container } = render(<DateDisplay value="2026-11-06T08:30:00+02:00" />)
    expect(container.querySelector('time')).toHaveTextContent('06 Nov 2026')
  })

  it('renders relative days against today', () => {
    const { container, rerender } = render(<DateDisplay value="2026-11-18" style="relative" today="2026-11-06" />)
    expect(container.querySelector('time')).toHaveTextContent('in 12 days')
    rerender(<DateDisplay value="2026-11-03" style="relative" today="2026-11-06" />)
    expect(container.querySelector('time')).toHaveTextContent('3 days ago')
    rerender(<DateDisplay value="2026-11-06" style="relative" today="2026-11-06" />)
    expect(container.querySelector('time')).toHaveTextContent('today')
  })

  it('renders an em dash for missing values', () => {
    render(<DateDisplay value={null} />)
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('No date')).toHaveClass('sr-only')
  })
})
