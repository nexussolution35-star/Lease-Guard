import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'

import { noStore } from './no-store'

describe('noStore', () => {
  it('sets Cache-Control: no-store and continues', () => {
    const setHeader = vi.fn()
    const next = vi.fn()

    noStore()({} as IncomingMessage, { setHeader } as unknown as ServerResponse, next)

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    expect(next).toHaveBeenCalledOnce()
  })
})
