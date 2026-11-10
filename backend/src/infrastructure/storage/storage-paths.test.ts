import { describe, expect, it } from 'vitest'

import { MAX_STORAGE_FILE_NAME_LENGTH, parseStorageObjectPath, storageFileName, storageObjectPath } from './storage-paths'

const COMPANY = '3ab0fc4a-eadb-50b8-bc4d-5673ada1519e'
const ENTITY = '6f1d2c1e-0000-4000-8000-0000000000aa'

describe('storageFileName', () => {
  it('keeps safe names unchanged', () => {
    expect(storageFileName('MSQ-2026-10_statement.pdf')).toBe('MSQ-2026-10_statement.pdf')
  })

  it('removes accents, path separators and unsafe characters', () => {
    expect(storageFileName('Café Société (Oct 2026).pdf')).toBe('Cafe-Societe-Oct-2026.pdf')
    expect(storageFileName('../../etc/passwd')).toBe('etc-passwd')
    expect(storageFileName('a\\b/c.pdf')).toBe('a-b-c.pdf')
  })

  it('never returns an empty or dot-leading name', () => {
    expect(storageFileName('')).toBe('document')
    expect(storageFileName('...')).toBe('document')
    expect(storageFileName('.hidden.pdf')).toBe('hidden.pdf')
  })

  it('shortens long names and keeps the extension', () => {
    const name = storageFileName(`${'x'.repeat(300)}.pdf`)
    expect(name).toHaveLength(MAX_STORAGE_FILE_NAME_LENGTH)
    expect(name.endsWith('.pdf')).toBe(true)
  })
})

describe('storageObjectPath', () => {
  it('builds <company>/<entity>/<file>', () => {
    expect(storageObjectPath(COMPANY, ENTITY, 'Oct 2026.pdf')).toBe(`${COMPANY}/${ENTITY}/Oct-2026.pdf`)
  })

  it('rejects ids the storage policies would not accept', () => {
    expect(() => storageObjectPath(COMPANY.toUpperCase(), ENTITY, 'a.pdf')).toThrow()
    expect(() => storageObjectPath(COMPANY, 'not-a-uuid', 'a.pdf')).toThrow()
  })
})

describe('parseStorageObjectPath', () => {
  it('round-trips a built path', () => {
    expect(parseStorageObjectPath(storageObjectPath(COMPANY, ENTITY, 'Oct 2026.pdf'))).toEqual({
      companyId: COMPANY,
      entityId: ENTITY,
      fileName: 'Oct-2026.pdf',
    })
  })

  it.each([
    `${COMPANY}/${ENTITY}`,
    `${COMPANY}/${ENTITY}/a/b.pdf`,
    `/${COMPANY}/${ENTITY}/a.pdf`,
    `${COMPANY}/${ENTITY}/../a.pdf`,
    `${COMPANY}/${ENTITY}/a b.pdf`,
    `${COMPANY.toUpperCase()}/${ENTITY}/a.pdf`,
    `not-a-company/${ENTITY}/a.pdf`,
  ])('rejects %s', (path) => {
    expect(parseStorageObjectPath(path)).toBeNull()
  })
})
