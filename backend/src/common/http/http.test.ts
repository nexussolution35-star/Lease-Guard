import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ZodValidationPipe } from '../pipes/zod-validation.pipe'
import { conflictWithDatabaseMessage, httpErrorFromDatabase, unwrapDatabase } from './database-errors'
import { emptyPageWithTotal, isPageOutOfRange, listQuerySchema, pageQuerySchema, rangeFor, searchFilter } from './pagination'

describe('pagination', () => {
  it('applies defaults and bounds', () => {
    expect(pageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25, direction: 'asc', search: undefined })
    expect(pageQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false)
    expect(pageQuerySchema.safeParse({ page: '0' }).success).toBe(false)
    expect(pageQuerySchema.parse({ search: '   ' }).search).toBeUndefined()
  })

  it('only accepts allow-listed sort fields', () => {
    const schema = listQuerySchema(['name'] as const, {})
    expect(schema.parse({ sort: 'name' }).sort).toBe('name')
    expect(schema.safeParse({ sort: 'password' }).success).toBe(false)
  })

  it('computes inclusive ranges', () => {
    expect(rangeFor({ page: 1, pageSize: 25 })).toEqual([0, 24])
    expect(rangeFor({ page: 3, pageSize: 10 })).toEqual([20, 29])
  })

  it('quotes search terms so they cannot change the filter', () => {
    expect(searchFilter(['name'], 'a,b.c(d)')).toBe('name.ilike."%a,b.c(d)%"')
    expect(searchFilter(['name'], '50%_off')).toBe('name.ilike."%50\\\\%\\\\_off%"')
    expect(searchFilter(['name', 'code'], 'say "hi"')).toBe('name.ilike."%say \\"hi\\"%",code.ilike."%say \\"hi\\"%"')
  })

  it("matches '*' literally: PostgREST would turn it into a % wildcard inside ilike", () => {
    // A bare '*' must not match every row.
    expect(searchFilter(['name'], '*')).toBe(String.raw`name.imatch."\\*"`)
    expect(searchFilter(['name', 'code'], 'R*500')).toBe(String.raw`name.imatch."R\\*500",code.imatch."R\\*500"`)
    expect(searchFilter(['name'], '*').includes('ilike')).toBe(false)
  })

  it("escapes every regex metacharacter and the quoting in a term with '*'", () => {
    // Regex escape first (\. \( ...), then the quoted-value escape doubles each backslash and escapes ".
    expect(searchFilter(['name'], String.raw`a*.+?^$[]{}()|\ "x" 50%_,`)).toBe(
      String.raw`name.imatch."a\\*\\.\\+\\?\\^\\$\\[\\]\\{\\}\\(\\)\\|\\\\ \"x\" 50%_,"`,
    )
  })
})

describe('out-of-range pages', () => {
  it('recognises PostgREST range errors only', () => {
    expect(isPageOutOfRange({ code: 'PGRST103' })).toBe(true)
    expect(isPageOutOfRange({ code: 'PGRST116' })).toBe(false)
    expect(isPageOutOfRange(null)).toBe(false)
  })

  it('returns the real total, or the database error', async () => {
    await expect(emptyPageWithTotal(Promise.resolve({ count: 12, error: null }), { page: 9, pageSize: 25 }, 'test')).resolves.toEqual({
      items: [],
      total: 12,
      page: 9,
      pageSize: 25,
    })
    await expect(
      emptyPageWithTotal(Promise.resolve({ count: null, error: { code: '42501', message: 'denied' } }), { page: 9, pageSize: 25 }, 'test'),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('ZodValidationPipe', () => {
  it('returns parsed values and lists every problem', () => {
    const pipe = new ZodValidationPipe(z.object({ page: z.coerce.number().int().min(1), name: z.string() }))
    expect(pipe.transform({ page: '2', name: 'x' })).toEqual({ page: 2, name: 'x' })
    try {
      pipe.transform({ page: '0' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      const messages = ((error as BadRequestException).getResponse() as { message: string[] }).message
      expect(messages).toHaveLength(2)
      expect(messages[0]).toMatch(/^page: /)
      expect(messages[1]).toMatch(/^name: /)
    }
  })
})

describe('database errors', () => {
  it.each([
    ['PGRST116', NotFoundException],
    ['23505', ConflictException],
    ['42501', ForbiddenException],
    ['22P02', BadRequestException],
    ['23514', UnprocessableEntityException],
    ['XX000', InternalServerErrorException],
  ])('maps %s', (code, type) => {
    expect(httpErrorFromDatabase({ code, message: 'detail' }, 'test')).toBeInstanceOf(type)
  })

  it('never returns database details except trigger business-rule messages', () => {
    expect(httpErrorFromDatabase({ code: '23514', message: 'leases_check' }, 'test').message).not.toContain('leases_check')
    expect(httpErrorFromDatabase({ code: 'P0001', message: 'Lease must be verified first' }, 'test').message).toBe(
      'Lease must be verified first',
    )
  })

  it('unwraps data or throws', () => {
    expect(unwrapDatabase({ data: 1, error: null }, 'test')).toBe(1)
    expect(() => unwrapDatabase({ data: null, error: null }, 'test')).toThrow(NotFoundException)
  })

  it('applies a per-call override to its code only, keeping the default for every other code', () => {
    const overrides = { P0001: conflictWithDatabaseMessage }
    const lastAdmin = { code: 'P0001', message: 'a company must keep at least one active company admin' }

    const overridden = httpErrorFromDatabase(lastAdmin, 'test', overrides)
    expect(overridden).toBeInstanceOf(ConflictException)
    expect(overridden.message).toBe(lastAdmin.message)
    expect(httpErrorFromDatabase({ code: '42501', message: 'denied' }, 'test', overrides)).toBeInstanceOf(ForbiddenException)
    // Without overrides P0001 stays a 422.
    expect(httpErrorFromDatabase(lastAdmin, 'test')).toBeInstanceOf(UnprocessableEntityException)
    expect(() => unwrapDatabase({ data: null, error: lastAdmin }, 'test', overrides)).toThrow(ConflictException)
  })
})
