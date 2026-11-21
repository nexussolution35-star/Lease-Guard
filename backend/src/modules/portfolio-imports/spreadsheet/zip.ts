import { inflateRawSync } from 'node:zlib'

import { PortfolioFileError } from './portfolio-file-error'

/**
 * A minimal ZIP reader for XLSX workbooks (an XLSX file is a ZIP of XML parts). It reads the central directory and
 * inflates entries on demand with Node's zlib: stored (0) and deflated (8) entries only, no ZIP64, no encryption,
 * which covers the workbooks spreadsheet programs write. Every entry is bounded by `maxEntryBytes` uncompressed, so a
 * small file cannot expand into an unbounded amount of memory.
 */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50
/** The end record is 22 bytes plus a comment of at most 65535 bytes. */
const MAX_END_RECORD_SEARCH = 22 + 0xffff

interface ZipEntry {
  method: number
  flags: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export interface ZipArchive {
  /** Entry names, as stored. */
  readonly names: readonly string[]
  /** The uncompressed bytes of an entry; `null` when the archive has no such entry. */
  read(name: string): Buffer | null
}

const unreadable = (detail: string) =>
  new PortfolioFileError('unreadable', `The workbook could not be read (${detail}). Save it again as .xlsx, or as CSV, and upload it again.`)

export function openZip(bytes: Buffer, maxEntryBytes: number): ZipArchive {
  const end = findEndRecord(bytes)
  const entryCount = bytes.readUInt16LE(end + 10)
  const directorySize = bytes.readUInt32LE(end + 12)
  const directoryOffset = bytes.readUInt32LE(end + 16)
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw unreadable('ZIP64 archives are not supported')
  if (directoryOffset + directorySize > bytes.length) throw unreadable('the archive is truncated')

  const entries = new Map<string, ZipEntry>()
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) throw unreadable('the archive directory is damaged')
    const flags = bytes.readUInt16LE(offset + 8)
    const method = bytes.readUInt16LE(offset + 10)
    const compressedSize = bytes.readUInt32LE(offset + 20)
    const uncompressedSize = bytes.readUInt32LE(offset + 24)
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const localHeaderOffset = bytes.readUInt32LE(offset + 42)
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.set(name, { method, flags, compressedSize, uncompressedSize, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }

  return {
    names: [...entries.keys()],
    read(name) {
      const entry = entries.get(name)
      if (!entry) return null
      return inflateEntry(bytes, name, entry, maxEntryBytes)
    },
  }
}

function findEndRecord(bytes: Buffer): number {
  const stop = Math.max(0, bytes.length - MAX_END_RECORD_SEARCH)
  for (let offset = bytes.length - 22; offset >= stop; offset--) {
    if (bytes.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset
  }
  throw unreadable('it is not a complete ZIP archive')
}

function inflateEntry(bytes: Buffer, name: string, entry: ZipEntry, maxEntryBytes: number): Buffer {
  if (entry.flags & 0x1) {
    throw new PortfolioFileError('unreadable', 'The workbook is password-protected. Remove the password, save it as .xlsx and upload it again.')
  }
  if (entry.uncompressedSize > maxEntryBytes) throw tooLarge()
  const header = entry.localHeaderOffset
  if (header + 30 > bytes.length || bytes.readUInt32LE(header) !== LOCAL_FILE_HEADER) throw unreadable(`the part ${name} is damaged`)
  const start = header + 30 + bytes.readUInt16LE(header + 26) + bytes.readUInt16LE(header + 28)
  const end = start + entry.compressedSize
  if (end > bytes.length) throw unreadable('the archive is truncated')
  const data = bytes.subarray(start, end)

  if (entry.method === 0) return Buffer.from(data)
  if (entry.method !== 8) throw unreadable(`the part ${name} uses an unsupported compression method`)
  try {
    return inflateRawSync(data, { maxOutputLength: maxEntryBytes })
  } catch (error) {
    if (error instanceof RangeError || (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge()
    throw unreadable(`the part ${name} is damaged`)
  }
}

const tooLarge = () =>
  new PortfolioFileError('too_large', 'The workbook holds more data than LeaseGuard reads in one import. Split it into smaller files and upload them one by one.')
