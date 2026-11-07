import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseFormReturn } from 'react-hook-form'
import { CurrencyField } from './CurrencyField'
import { TestForm } from './testHarness'

interface Values {
  rent?: number
}

function setup(props: { allowNegative?: boolean; defaultValues?: Values } = {}) {
  let form: UseFormReturn<Values> | undefined
  render(
    <TestForm<Values> defaultValues={props.defaultValues} onReady={(f) => (form = f)}>
      {(control) => (
        <CurrencyField
          control={control}
          name="rent"
          label="Monthly rental"
          required
          allowNegative={props.allowNegative}
        />
      )}
    </TestForm>,
  )
  return { getValue: () => form?.getValues('rent') }
}

describe('CurrencyField', () => {
  it('parses SA formatted input on blur and stores a 2dp number', async () => {
    const user = userEvent.setup()
    const { getValue } = setup()
    const input = screen.getByLabelText(/Monthly rental/)
    await user.type(input, '35 000,5')
    await user.tab()
    expect(getValue()).toBe(35000.5)
    expect(input).toHaveValue('35 000,50')
  })

  it('accepts R-prefixed comma-grouped input', async () => {
    const user = userEvent.setup()
    const { getValue } = setup()
    const input = screen.getByLabelText(/Monthly rental/)
    await user.type(input, 'R35,000.504')
    await user.tab()
    expect(getValue()).toBe(35000.5)
  })

  it('formats an existing value without duplicating the rand symbol', () => {
    setup({ defaultValues: { rent: 37800 } })
    expect(screen.getByLabelText(/Monthly rental/)).toHaveValue('37 800,00')
    expect(screen.getAllByText('R')).toHaveLength(1)
  })

  it('rejects negative amounts when not allowed', async () => {
    const user = userEvent.setup()
    const { getValue } = setup()
    const input = screen.getByLabelText(/Monthly rental/)
    await user.type(input, '-500')
    await user.tab()
    expect(getValue()).toBeUndefined()
    expect(screen.getByRole('alert')).toHaveTextContent('Amount cannot be negative')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveValue('-500')
  })

  it('allows negative amounts when allowNegative is set', async () => {
    const user = userEvent.setup()
    const { getValue } = setup({ allowNegative: true })
    await user.type(screen.getByLabelText(/Monthly rental/), '-1 200,00')
    await user.tab()
    expect(getValue()).toBe(-1200)
  })

  it('flags unparseable input instead of guessing', async () => {
    const user = userEvent.setup()
    const { getValue } = setup()
    await user.type(screen.getByLabelText(/Monthly rental/), 'abc')
    await user.tab()
    expect(getValue()).toBeUndefined()
    expect(screen.getByRole('alert')).toHaveTextContent(/valid rand amount/)
  })

  it('exposes label, required indicator and input attributes', () => {
    setup()
    const input = screen.getByLabelText(/Monthly rental/)
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(input).toHaveAttribute('inputmode', 'decimal')
    expect(input).toHaveAttribute('id', 'field-rent')
    expect(screen.getByText('(required)')).toHaveClass('sr-only')
  })
})
