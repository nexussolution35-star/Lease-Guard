import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseFormReturn } from 'react-hook-form'
import { CheckboxField } from './CheckboxField'
import { DateField } from './DateField'
import { MultiSelectField } from './MultiSelectField'
import { PhoneNumberField } from './PhoneNumberField'
import { RadioGroupField } from './RadioGroupField'
import { SelectField } from './SelectField'
import { TestForm } from './testHarness'

interface Values {
  start?: string
  types: string[]
  verified: boolean
  basis?: string
  kind?: string
  phone?: string
}

const OPTIONS = [
  { value: 'retail', label: 'Retail' },
  { value: 'office', label: 'Office' },
]

function setup() {
  let form: UseFormReturn<Values> | undefined
  render(
    <TestForm<Values>
      defaultValues={{ start: '2026-11-06', types: [], verified: false }}
      onReady={(f) => (form = f)}
    >
      {(control) => (
        <>
          <DateField control={control} name="start" label="Start date" required />
          <MultiSelectField control={control} name="types" label="Unit types" options={OPTIONS} />
          <CheckboxField control={control} name="verified" label="Lease verified" />
          <RadioGroupField
            control={control}
            name="basis"
            label="Escalation basis"
            options={[
              { value: 'percentage', label: 'Percentage', description: 'Fixed % per year' },
              { value: 'fixed_amount', label: 'Fixed amount' },
            ]}
          />
          <SelectField control={control} name="kind" label="Kind" options={OPTIONS} />
          <PhoneNumberField control={control} name="phone" label="Mobile" />
        </>
      )}
    </TestForm>,
  )
  return { values: () => form!.getValues() }
}

describe('form fields (smoke)', () => {
  it('DateField shows SA date, picks and clears', async () => {
    const user = userEvent.setup()
    const { values } = setup()
    const trigger = screen.getByRole('button', { name: /Start date.*06 Nov 2026/ })
    expect(trigger).toHaveAttribute('aria-required', 'true')
    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: /November 20th, 2026/ }))
    expect(values().start).toBe('2026-11-20')
    await user.click(screen.getByRole('button', { name: 'Clear Start date' }))
    expect(values().start).toBeUndefined()
  })

  it('MultiSelectField toggles options and removes badges', async () => {
    const user = userEvent.setup()
    const { values } = setup()
    await user.click(screen.getByRole('combobox', { name: /Unit types/ }))
    await user.click(await screen.findByRole('option', { name: /Office/ }))
    expect(values().types).toEqual(['office'])
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Remove Office' }))
    expect(values().types).toEqual([])
  })

  it('CheckboxField, RadioGroupField and PhoneNumberField update values', async () => {
    const user = userEvent.setup()
    const { values } = setup()
    await user.click(screen.getByRole('checkbox', { name: 'Lease verified' }))
    expect(values().verified).toBe(true)
    expect(screen.getByRole('radiogroup', { name: 'Escalation basis' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Fixed amount' }))
    expect(values().basis).toBe('fixed_amount')
    const phone = screen.getByLabelText('Mobile')
    await user.type(phone, '082 123 4567')
    await user.tab()
    expect(values().phone).toBe('+27821234567')
    expect(phone).toHaveValue('+27 82 123 4567')
  })

  it('SelectField renders a labelled trigger', () => {
    setup()
    expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveTextContent('Select…')
  })
})
