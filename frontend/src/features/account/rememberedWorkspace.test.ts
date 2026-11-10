import { describe, expect, it } from 'vitest'

import { NEXUS_ID, SECOND_ID, TEST_USER_ID } from '@/test/accountFixtures'

import { readRememberedWorkspace, rememberWorkspace } from './rememberedWorkspace'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) }
}

describe('remembered workspace', () => {
  it('remembers the last workspace per user', () => {
    const storage = memoryStorage()
    expect(readRememberedWorkspace(TEST_USER_ID, storage)).toBeNull()
    rememberWorkspace(TEST_USER_ID, NEXUS_ID, storage)
    rememberWorkspace('another-user', SECOND_ID, storage)
    expect(readRememberedWorkspace(TEST_USER_ID, storage)).toBe(NEXUS_ID)
    expect(readRememberedWorkspace('another-user', storage)).toBe(SECOND_ID)
  })

  it('works without storage and survives storage that throws', () => {
    expect(readRememberedWorkspace(TEST_USER_ID, null)).toBeNull()
    rememberWorkspace(TEST_USER_ID, NEXUS_ID, null)
    const broken: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => rememberWorkspace(TEST_USER_ID, NEXUS_ID, broken)).not.toThrow()
    expect(readRememberedWorkspace(TEST_USER_ID, broken)).toBeNull()
  })

  it('never stores anything for an unknown user', () => {
    const storage = memoryStorage()
    rememberWorkspace('', NEXUS_ID, storage)
    expect(readRememberedWorkspace('', storage)).toBeNull()
  })
})
