import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseFormReturn } from 'react-hook-form'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AddressLookupError, type AddressSuggestionSource, type SuggestedAddress } from '@/services/maps/addressSuggestions'

import { AddressAutocompleteField } from './AddressAutocompleteField'
import { TestForm } from './testHarness'

interface Values {
  line1: string
}

const FREDMAN = { id: 'p1', primary: '12 Fredman Drive', secondary: 'Sandown, Sandton' }
const RIVONIA = { id: 'p2', primary: '12 Rivonia Road', secondary: 'Illovo, Sandton' }
const ADDRESS: SuggestedAddress = { line1: '12 Fredman Drive', suburb: 'Sandown', city: 'Sandton', province: 'Gauteng', postalCode: '2196' }

const source = {
  available: vi.fn<AddressSuggestionSource['available']>(),
  suggest: vi.fn<AddressSuggestionSource['suggest']>(),
  resolve: vi.fn<AddressSuggestionSource['resolve']>(),
}
const onAddressSelect = vi.fn<(address: SuggestedAddress) => void>()
let form: UseFormReturn<Values>

function renderField(withSource: AddressSuggestionSource = source) {
  return render(
    <TestForm<Values> defaultValues={{ line1: '' }} onReady={(f) => (form = f)}>
      {(control) => (
        <AddressAutocompleteField control={control} name="line1" label="Street address" description="Number and street." onAddressSelect={onAddressSelect} source={withSource} />
      )}
    </TestForm>,
  )
}

beforeEach(() => {
  source.available.mockReset().mockResolvedValue(true)
  source.suggest.mockReset().mockResolvedValue([FREDMAN, RIVONIA])
  source.resolve.mockReset().mockResolvedValue(ADDRESS)
  onAddressSelect.mockReset()
})

describe('AddressAutocompleteField', () => {
  it('suggests South African addresses after three characters and fills the address on a click', async () => {
    renderField()
    const input = await screen.findByRole('combobox', { name: 'Street address' })
    await userEvent.type(input, '12')
    expect(source.suggest).not.toHaveBeenCalled()

    await userEvent.type(input, ' Fr')
    expect(await screen.findByRole('option', { name: /12 Fredman Drive/ })).toBeInTheDocument()
    expect(source.suggest).toHaveBeenLastCalledWith('12 Fr')
    expect(screen.getByText('Google Maps')).toHaveAttribute('translate', 'no')

    await userEvent.click(screen.getByRole('option', { name: /12 Fredman Drive/ }))
    expect(source.resolve).toHaveBeenCalledWith(FREDMAN)
    expect(onAddressSelect).toHaveBeenCalledWith(ADDRESS)
    expect(form.getValues('line1')).toBe('12 Fredman Drive')
    expect(await screen.findByText(/Filled from Google Maps/)).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('chooses with the keyboard', async () => {
    renderField()
    const input = await screen.findByRole('combobox', { name: 'Street address' })
    await userEvent.type(input, '12 Ri')
    await screen.findByRole('option', { name: /12 Rivonia Road/ })
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringMatching(/-1$/))
    await userEvent.keyboard('{Enter}')
    expect(source.resolve).toHaveBeenCalledWith(RIVONIA)
  })

  it('closes on Escape and keeps what was typed', async () => {
    renderField()
    const input = await screen.findByRole('combobox', { name: 'Street address' })
    await userEvent.type(input, '12 Fr')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('12 Fr')
    expect(onAddressSelect).not.toHaveBeenCalled()
  })

  it('shows the API\'s words when a lookup is refused, e.g. the rate limit', async () => {
    source.suggest.mockRejectedValue(new AddressLookupError('Too many address lookups. Wait a moment, or type the address in full.'))
    renderField()
    const input = await screen.findByRole('combobox', { name: 'Street address' })
    await userEvent.type(input, '12 Fredman Drive')
    expect(await screen.findByText('Too many address lookups. Wait a moment, or type the address in full.')).toBeInTheDocument()
    expect(form.getValues('line1')).toBe('12 Fredman Drive')
  })

  it('says when suggestions are unavailable and lets the address be typed in full', async () => {
    source.suggest.mockRejectedValue(new Error('REQUEST_DENIED'))
    renderField()
    const input = await screen.findByRole('combobox', { name: 'Street address' })
    await userEvent.type(input, '12 Fredman Drive')
    expect(await screen.findByText('Address suggestions are unavailable. Type the address in full.')).toBeInTheDocument()
    expect(form.getValues('line1')).toBe('12 Fredman Drive')
  })

  it('is a plain text field when the deployment has no suggestions', async () => {
    source.available.mockResolvedValue(false)
    renderField()
    await vi.waitFor(() => expect(source.available).toHaveBeenCalled())
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Street address' })
    await userEvent.type(input, '12 Fredman Drive')
    expect(form.getValues('line1')).toBe('12 Fredman Drive')
    expect(screen.getByText('Number and street.')).toBeInTheDocument()
  })
})
