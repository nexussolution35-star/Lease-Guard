import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ConfirmationDialog } from './ConfirmationDialog'

describe('ConfirmationDialog', () => {
  it('keeps confirm disabled until a non-blank reason is entered', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ConfirmationDialog
        open
        onOpenChange={onOpenChange}
        title="Reject statement"
        confirmLabel="Reject"
        destructive
        requireReason
        reasonLabel="Rejection reason"
        onConfirm={onConfirm}
      />,
    )
    const confirm = screen.getByRole('button', { name: 'Reject' })
    expect(confirm).toBeDisabled()

    const reason = screen.getByLabelText('Rejection reason')
    await userEvent.type(reason, '   ')
    expect(confirm).toBeDisabled()

    await userEvent.type(reason, 'Wrong tenant ')
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('Wrong tenant')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('confirms without a reason when not required', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmationDialog open onOpenChange={() => {}} title="Archive?" onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })
})
