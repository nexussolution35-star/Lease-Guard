import { render, screen } from '@testing-library/react'

import { TONE_CLASSES } from '@/lib/labels'

import { PriorityBadge } from './PriorityBadge'
import { StatusBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('renders the label from labelFor and the tone classes', () => {
    render(<StatusBadge status="action_required" />)
    const badge = screen.getByText('Action required')
    expect(badge).toHaveAttribute('data-tone', 'danger')
    for (const cls of TONE_CLASSES.danger.split(' ')) expect(badge).toHaveClass(cls)
  })

  it('accepts a label override and falls back to neutral for unknown values', () => {
    render(<StatusBadge status="something_else" label="Custom" />)
    const badge = screen.getByText('Custom')
    expect(badge).toHaveAttribute('data-tone', 'neutral')
  })
})

describe('PriorityBadge', () => {
  it('renders the priority label with its tone', () => {
    render(<PriorityBadge priority="critical" />)
    expect(screen.getByText('Critical').closest('[data-tone]')).toHaveAttribute('data-tone', 'danger')
  })
})
