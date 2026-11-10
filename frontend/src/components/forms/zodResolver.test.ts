import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { zodResolver } from './zodResolver'

const schema = z.object({
  name: z.string().trim().min(1, 'Required'),
  escalation: z.object({ percentage: z.number().max(100, 'Too high') }),
})

const options = { fields: {}, shouldUseNativeValidation: false }

describe('zodResolver', () => {
  it('returns parsed values when valid', async () => {
    const result = await zodResolver(schema)({ name: ' Lease ', escalation: { percentage: 8 } }, undefined, options)
    expect(result).toEqual({ values: { name: 'Lease', escalation: { percentage: 8 } }, errors: {} })
  })

  it('nests errors by field path, first message per field', async () => {
    const result = await zodResolver(schema)({ name: '', escalation: { percentage: 120 } }, undefined, options)
    expect(result.values).toEqual({})
    expect(result.errors).toEqual({
      name: { type: 'too_small', message: 'Required' },
      escalation: { percentage: { type: 'too_big', message: 'Too high' } },
    })
  })
})
