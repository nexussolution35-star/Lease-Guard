import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common'
import type { z } from 'zod'

/**
 * Validates and normalises a request part (body, query or params) with a zod schema and returns the
 * parsed value. Failures become a 400 whose `message` lists every problem as `path: message`.
 *
 * Usage: `@Query(new ZodValidationPipe(propertyListQuerySchema)) query: PropertyListQueryDto`. The DTO
 * class documents the shape for OpenAPI; `assertSchemaMatchesDto` keeps the two in step at compile time.
 */
@Injectable()
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value)
    if (parsed.success) return parsed.data
    throw new BadRequestException(
      parsed.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)),
    )
  }
}

/**
 * Compile-time check that a zod schema's output is assignable to its OpenAPI DTO class and vice versa.
 * Use as `assertSchemaMatchesDto<z.infer<typeof schema>, MyDto>(true)`; a mismatch fails type checking.
 */
export function assertSchemaMatchesDto<Parsed, Dto>(
  _proof: [Parsed] extends [Dto] ? ([Dto] extends [Parsed] ? true : never) : never,
): void {}
