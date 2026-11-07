/** Pure helpers for `FileUpload`: accept-string matching, size limits and byte formatting. */

export interface RejectedFile {
  file: File
  reason: string
}

export interface FileValidationResult {
  accepted: File[]
  rejected: RejectedFile[]
}

export interface FileValidationOptions {
  /** Same syntax as `<input accept>`: MIME types, `type/*` wildcards, `.ext` extensions. */
  accept?: string
  maxSizeBytes?: number
  multiple?: boolean
}

/** `1536` → `1.5 KB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${Number(value.toFixed(1))} ${units[unit]}`
}

/** True when `file` matches the `accept` string (empty / undefined accepts everything). */
export function fileMatchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept || accept.trim() === '') return true
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token)
    if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1))
    return type === token
  })
}

function describeAccept(accept: string): string {
  return accept
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t === 'application/pdf' ? 'PDF' : t.startsWith('.') ? t.slice(1).toUpperCase() : t))
    .join(', ')
}

export function validateFiles(
  files: readonly File[],
  { accept, maxSizeBytes, multiple = false }: FileValidationOptions = {},
): FileValidationResult {
  const accepted: File[] = []
  const rejected: RejectedFile[] = []
  for (const file of files) {
    if (!fileMatchesAccept(file, accept)) {
      rejected.push({ file, reason: `File type not allowed. Accepted: ${describeAccept(accept ?? '')}.` })
    } else if (maxSizeBytes !== undefined && file.size > maxSizeBytes) {
      rejected.push({
        file,
        reason: `File is ${formatBytes(file.size)}; the limit is ${formatBytes(maxSizeBytes)}.`,
      })
    } else if (!multiple && accepted.length >= 1) {
      rejected.push({ file, reason: 'Only one file can be uploaded at a time.' })
    } else {
      accepted.push(file)
    }
  }
  return { accepted, rejected }
}
