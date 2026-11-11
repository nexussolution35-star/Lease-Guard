import { useId, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { FileWarning, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatBytes, validateFiles } from './fileValidation'
import type { RejectedFile } from './fileValidation'

export interface FileUploadProps {
  /** `<input accept>` syntax. Default `application/pdf`. */
  accept?: string
  multiple?: boolean
  maxSizeBytes?: number
  /** Called with the files that passed type / size validation (never called with none). */
  onFilesSelected: (files: File[]) => void
  label: string
  description?: string
  disabled?: boolean
  /** External error, e.g. from the consuming form. */
  error?: string
  className?: string
}

/**
 * Drag-and-drop zone with a keyboard-accessible "Choose file" button and a visually hidden
 * file input. Validates type and size and lists rejected files with reasons.
 */
export function FileUpload({
  accept = 'application/pdf',
  multiple = false,
  maxSizeBytes,
  onFilesSelected,
  label,
  description,
  disabled = false,
  error,
  className,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const baseId = useId()
  const inputId = `${baseId}-input`
  const labelId = `${baseId}-label`
  const descriptionId = `${baseId}-description`
  const errorId = `${baseId}-error`
  const [isDragging, setIsDragging] = useState(false)
  const [rejected, setRejected] = useState<RejectedFile[]>([])

  const handleFiles = (list: FileList | null) => {
    if (!list || disabled) return
    const result = validateFiles(Array.from(list), { accept, maxSizeBytes, multiple })
    setRejected(result.rejected)
    if (result.accepted.length > 0) onFilesSelected(result.accepted)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!disabled) setIsDragging(true)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    handleFiles(event.dataTransfer.files)
  }

  const describedBy =
    [description ? descriptionId : null, error || rejected.length > 0 ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined

  const limits = [
    accept === 'application/pdf' ? 'PDF only' : null,
    maxSizeBytes !== undefined ? `max ${formatBytes(maxSizeBytes)}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div data-slot="file-upload" className={cn('grid gap-2', className)}>
      <p id={labelId} className="text-sm leading-none font-medium">
        {label}
      </p>
      <div
        data-dragging={isDragging || undefined}
        data-disabled={disabled || undefined}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors',
          'data-[dragging]:border-primary data-[dragging]:bg-primary/5',
          'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
          (error || rejected.length > 0) && 'border-destructive/60',
        )}
      >
        <Upload className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm text-foreground">
            Drag and drop {multiple ? 'files' : 'a file'} here, or
          </p>
          {limits ? <p className="text-xs text-muted-foreground">{limits}</p> : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          aria-labelledby={`${labelId} ${baseId}-choose`}
          aria-describedby={describedBy}
        >
          <span id={`${baseId}-choose`}>{multiple ? 'Choose files' : 'Choose file'}</span>
        </Button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-label={label}
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            handleFiles(event.target.files)
            // Allow re-selecting the same file after a rejection.
            event.target.value = ''
          }}
        />
      </div>
      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground italic">
          {description}
        </p>
      ) : null}
      {error || rejected.length > 0 ? (
        <div id={errorId} role="alert" className="space-y-1 text-sm text-destructive">
          {error ? <p>{error}</p> : null}
          {rejected.length > 0 ? (
            <ul className="space-y-1">
              {rejected.map(({ file, reason }, index) => (
                <li key={`${file.name}-${index}`} className="flex items-start gap-2">
                  <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-medium">{file.name}</span>: {reason}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
