import {
  formatSAPhoneNumber,
  isValidSAPhoneNumber,
  normaliseSAPhoneNumber,
  saPhoneNumberSchema,
} from './phone'

describe('normaliseSAPhoneNumber', () => {
  it.each([
    ['082 123 4567', '+27821234567'],
    ['0821234567', '+27821234567'],
    ['+27 82 123 4567', '+27821234567'],
    ['+27821234567', '+27821234567'],
    ['+27 (0)82 123 4567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['0027 82 123 4567', '+27821234567'],
    ['082-123-4567', '+27821234567'],
    ['(021) 555 1234', '+27215551234'],
  ])('normalises %s', (input, expected) => {
    expect(normaliseSAPhoneNumber(input)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    '12345',
    '082 123 456',
    '082 123 45678',
    '+44 20 7946 0958',
    '+27 0821234567',
    '0921234567',
    '0021234567',
    'abc 082 123 4567',
  ])('rejects %j', (input) => {
    expect(normaliseSAPhoneNumber(input)).toBeNull()
    expect(isValidSAPhoneNumber(input)).toBe(false)
  })
})

describe('formatSAPhoneNumber', () => {
  it('formats E.164 for display', () => {
    expect(formatSAPhoneNumber('+27821234567')).toBe('+27 82 123 4567')
    expect(formatSAPhoneNumber('0215551234')).toBe('+27 21 555 1234')
  })

  it('returns invalid input unchanged', () => {
    expect(formatSAPhoneNumber('12345')).toBe('12345')
  })
})

describe('saPhoneNumberSchema', () => {
  it('validates and transforms to E.164', () => {
    expect(saPhoneNumberSchema.parse(' 082 123 4567 ')).toBe('+27821234567')
  })

  it('reports a helpful error', () => {
    const result = saPhoneNumberSchema.safeParse('123')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/South African number/)
  })
})
