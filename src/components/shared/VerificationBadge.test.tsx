import { render, screen } from '@testing-library/react'

import { VerificationBadge } from './VerificationBadge'

describe('VerificationBadge', () => {
  it('shows Verified with details in the title', () => {
    render(<VerificationBadge verified verifiedAt="2026-11-06T08:30:00+02:00" verifiedBy="Thandi M" />)
    const badge = screen.getByText('Verified')
    expect(badge).toHaveAttribute('data-tone', 'success')
    expect(badge).toHaveAttribute('title', 'Verified 06 Nov 2026, 08:30 by Thandi M')
  })

  it('shows Unverified with a warning tone', () => {
    render(<VerificationBadge verified={false} />)
    const badge = screen.getByText('Unverified')
    expect(badge).toHaveAttribute('data-tone', 'warning')
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
  })
})
