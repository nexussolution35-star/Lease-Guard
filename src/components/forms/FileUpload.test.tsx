import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileUpload } from './FileUpload'
import { validateFiles } from './fileValidation'

function makeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('validateFiles', () => {
  it('accepts by MIME, wildcard and extension', () => {
    const pdf = makeFile('a.pdf', 'application/pdf', 10)
    const png = makeFile('b.png', 'image/png', 10)
    expect(validateFiles([pdf], { accept: 'application/pdf' }).accepted).toEqual([pdf])
    expect(validateFiles([png], { accept: 'image/*' }).accepted).toEqual([png])
    expect(validateFiles([png], { accept: '.png' }).accepted).toEqual([png])
  })
})

describe('FileUpload', () => {
  it('passes valid files and rejects wrong type and oversize files with reasons', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const onFilesSelected = vi.fn()
    render(
      <FileUpload
        label="Statement PDF"
        multiple
        maxSizeBytes={1024 * 1024}
        onFilesSelected={onFilesSelected}
      />,
    )
    const good = makeFile('statement.pdf', 'application/pdf', 2048)
    const wrongType = makeFile('photo.jpg', 'image/jpeg', 2048)
    const tooBig = makeFile('huge.pdf', 'application/pdf', 5 * 1024 * 1024)

    await user.upload(screen.getByLabelText('Statement PDF', { selector: 'input' }), [good, wrongType, tooBig])

    expect(onFilesSelected).toHaveBeenCalledWith([good])
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('photo.jpg: File type not allowed. Accepted: PDF.')
    expect(alert).toHaveTextContent('huge.pdf: File is 5 MB; the limit is 1 MB.')
  })

  it('does not call onFilesSelected when every file is rejected', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const onFilesSelected = vi.fn()
    render(<FileUpload label="Lease" onFilesSelected={onFilesSelected} />)
    await user.upload(screen.getByLabelText('Lease', { selector: 'input' }), makeFile('notes.txt', 'text/plain', 10))
    expect(onFilesSelected).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('notes.txt')
  })

  it('has a keyboard reachable choose button', () => {
    render(<FileUpload label="Lease" onFilesSelected={() => {}} />)
    expect(screen.getByRole('button', { name: /Lease Choose file/ })).toBeEnabled()
  })
})
