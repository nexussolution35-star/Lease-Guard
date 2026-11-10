import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'

/** The parts of a PostgREST / Postgres error the API reacts to. */
export interface DatabaseErrorLike {
  code: string
  message: string
  details?: string | null
  hint?: string | null
}

const logger = new Logger('Database')

/**
 * Per-call replacements for the default mapping, keyed by Postgres/PostgREST error code. A caller that
 * knows what a code means for its operation (e.g. P0001 "last company admin" → 409) passes one;
 * every other code keeps the default mapping.
 */
export type DatabaseErrorOverrides = Readonly<Partial<Record<string, (error: DatabaseErrorLike) => HttpException>>>

/**
 * Override that answers 409 with the database's own message. Only for codes whose message is written
 * for users, i.e. P0001 raised by our triggers (`raise exception '...'`), never constraint violations.
 */
export const conflictWithDatabaseMessage = (error: DatabaseErrorLike): HttpException => new ConflictException(error.message)

/**
 * Converts a Supabase/PostgREST error into the HTTP error the client should see. Database details are
 * logged, never returned: constraint and policy names would leak the schema. `overrides` replaces the
 * mapping of specific codes for this call only.
 */
export function httpErrorFromDatabase(error: DatabaseErrorLike, operation: string, overrides: DatabaseErrorOverrides = {}): HttpException {
  const override = overrides[error.code]
  if (override) {
    logger.warn(`${operation} rejected by the database (${error.code}): ${error.message}`)
    return override(error)
  }
  switch (error.code) {
    case 'PGRST116': // .single() found no row (RLS hides other companies' rows, so this is also "not yours").
      return new NotFoundException('The record was not found')
    case '23505':
      return new ConflictException('The record conflicts with an existing record')
    case '42501': // Row Level Security or privilege denial.
      return new ForbiddenException('You are not allowed to perform this action')
    case '22P02': // Invalid text representation, e.g. a malformed uuid or enum value.
      return new BadRequestException('The request contains an invalid value')
    case '23503':
    case '23514':
    case '23502':
    case 'P0001': // raise exception from a trigger (business rule).
      logger.warn(`${operation} rejected by the database (${error.code}): ${error.message}`)
      return new UnprocessableEntityException(
        error.code === 'P0001' ? error.message : 'The record breaks a data integrity rule',
      )
    default:
      if (error.code.startsWith('PGRST0') || error.code === '') {
        logger.error(`${operation} failed: database unreachable (${error.code}): ${error.message}`)
        return new ServiceUnavailableException('The database is not available')
      }
      logger.error(`${operation} failed (${error.code}): ${error.message} ${error.details ?? ''}`)
      return new InternalServerErrorException('An unexpected error occurred')
  }
}

/** Returns `data` or throws the HTTP error matching `error` (see `httpErrorFromDatabase` for `overrides`). */
export function unwrapDatabase<R extends { data: unknown; error: DatabaseErrorLike | null }>(
  result: R,
  operation: string,
  overrides: DatabaseErrorOverrides = {},
): NonNullable<R['data']> {
  if (result.error) throw httpErrorFromDatabase(result.error, operation, overrides)
  if (result.data === null || result.data === undefined) throw new NotFoundException('The record was not found')
  return result.data as NonNullable<R['data']>
}
