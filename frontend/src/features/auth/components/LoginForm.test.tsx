import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SignInError } from '../signInError'
import { LoginForm } from './LoginForm'

function setup(onSubmit = vi.fn<(values: { email: string; password: string }) => Promise<void>>(async () => undefined)) {
  render(<LoginForm onSubmit={onSubmit} />)
  return { onSubmit, email: screen.getByLabelText(/email address/i), password: screen.getByLabelText(/password/i) }
}

describe('LoginForm', () => {
  it('requires an email address and password', async () => {
    const { onSubmit } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email address')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects an invalid email address', async () => {
    const { onSubmit, email, password } = setup()
    await userEvent.type(email, 'not-an-email')
    await userEvent.type(password, 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed credentials', async () => {
    const { onSubmit, email, password } = setup()
    await userEvent.type(email, '  sipho.dlamini@nexussolution.co.za ')
    await userEvent.type(password, 'a-test-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ email: 'sipho.dlamini@nexussolution.co.za', password: 'a-test-password' }),
    )
  })

  it('shows the sign-in failure above the form', async () => {
    const { email, password } = setup(vi.fn(async () => Promise.reject(new SignInError('The email address or password is incorrect.'))))
    await userEvent.type(email, 'sipho.dlamini@nexussolution.co.za')
    await userEvent.type(password, 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('The email address or password is incorrect.')).toBeInTheDocument()
  })
})
