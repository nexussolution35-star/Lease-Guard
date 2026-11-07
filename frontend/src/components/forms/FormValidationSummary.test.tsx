import { render, screen } from '@testing-library/react'
import type { FieldErrors, FieldValues } from 'react-hook-form'
import { flattenErrors } from './flattenErrors'
import { FormValidationSummary } from './FormValidationSummary'

const nested = {
  tenantName: { type: 'too_small', message: 'Tenant name is required' },
  escalation: {
    percentage: { type: 'too_big', message: 'Percentage cannot exceed 100' },
  },
  charges: [undefined, { amount: { type: 'custom', message: 'Enter an amount' } }],
  root: { serverError: { type: 'server', message: 'Could not save lease' } },
} as unknown as FieldErrors<FieldValues>

describe('flattenErrors', () => {
  it('flattens nested RHF errors into dotted paths', () => {
    expect(flattenErrors(nested)).toEqual([
      { path: 'tenantName', message: 'Tenant name is required' },
      { path: 'escalation.percentage', message: 'Percentage cannot exceed 100' },
      { path: 'charges.1.amount', message: 'Enter an amount' },
      { path: 'root.serverError', message: 'Could not save lease' },
    ])
  })

  it('accepts a plain record', () => {
    expect(flattenErrors({ email: 'Invalid e-mail' })).toEqual([
      { path: 'email', message: 'Invalid e-mail' },
    ])
  })
})

describe('FormValidationSummary', () => {
  it('renders nothing without errors', () => {
    const { container } = render(<FormValidationSummary errors={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists errors with links to field ids', () => {
    render(
      <FormValidationSummary
        errors={nested}
        fieldLabels={{ 'escalation.percentage': 'Escalation %' }}
      />,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Escalation %: Percentage cannot exceed 100/ })
    expect(link).toHaveAttribute('href', '#field-escalation-percentage')
    expect(screen.getByRole('link', { name: /Tenant name: Tenant name is required/ })).toHaveAttribute(
      'href',
      '#field-tenantName',
    )
    expect(screen.getByRole('link', { name: /Amount: Enter an amount/ })).toHaveAttribute(
      'href',
      '#field-charges-1-amount',
    )
  })
})
