import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseFormReturn } from 'react-hook-form'
import { NumberField } from './NumberField'
import { parseNumberInput } from './numberInput'
import { TestForm } from './testHarness'

interface Values {
  escalation?: number
}

function setup(defaultValues?: Values) {
  let form: UseFormReturn<Values> | undefined
  render(
    <TestForm<Values> defaultValues={defaultValues} onReady={(f) => (form = f)}>
      {(control) => (
        <NumberField control={control} name="escalation" label="Escalation" suffix="%" min={0} max={100} />
      )}
    </TestForm>,
  )
  return { getValue: () => form?.getValues('escalation') }
}

describe('parseNumberInput', () => {
  it('handles empty, decimal comma and junk', () => {
    expect(parseNumberInput('')).toBeUndefined()
    expect(parseNumberInput('  ')).toBeUndefined()
    expect(parseNumberInput('-')).toBeUndefined()
    expect(parseNumberInput('abc')).toBeUndefined()
    expect(parseNumberInput('7,5')).toBe(7.5)
    expect(parseNumberInput('1 200')).toBe(1200)
  })
})

describe('NumberField', () => {
  it('emits numbers and undefined (never NaN) when cleared', async () => {
    const user = userEvent.setup()
    const { getValue } = setup({ escalation: 8 })
    const input = screen.getByLabelText('Escalation')
    expect(input).toHaveValue('8')
    await user.clear(input)
    expect(getValue()).toBeUndefined()
    await user.type(input, '7.5')
    expect(getValue()).toBe(7.5)
    await user.clear(input)
    await user.type(input, 'x')
    expect(getValue()).toBeUndefined()
    expect(screen.getByText('%')).toBeInTheDocument()
  })

  it('steps with arrow keys within min/max', async () => {
    const user = userEvent.setup()
    const { getValue } = setup({ escalation: 100 })
    const input = screen.getByRole('spinbutton', { name: 'Escalation' })
    await user.click(input)
    await user.keyboard('{ArrowUp}')
    expect(getValue()).toBe(100)
    await user.keyboard('{ArrowDown}')
    expect(getValue()).toBe(99)
  })
})
