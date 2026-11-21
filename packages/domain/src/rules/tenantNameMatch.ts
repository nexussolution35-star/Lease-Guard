/**
 * Whether two tenant names are alike enough to suggest that they are the same tenant (portfolio import, ticket I-05).
 * A similar name is only ever a suggestion for a person to confirm or reject: tenants are never merged on names alone.
 */

/** Words that say what kind of entity a business is, not which one: left out when names are compared. */
const ENTITY_WORDS: ReadonlySet<string> = new Set([
  'pty', 'ltd', 'limited', 'proprietary', 'cc', 'npc', 'inc', 'incorporated', 'co', 'company', 'the', 'ta', 'trading', 'as',
])

/**
 * A tenant name reduced to the words that identify it: lower case, accents and punctuation dropped, `&` read as `and`,
 * and entity words such as (Pty) Ltd, CC and t/a left out. "Bean There Coffee (Pty) Ltd" becomes `bean there coffee`.
 */
export function tenantNameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bt\/a\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 1 && !ENTITY_WORDS.has(word))
    .join(' ')
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

/**
 * Whether two tenant names are similar: the same identifying words (whatever the case, punctuation or entity words),
 * every identifying word of one in the other ("Bean There" and "Bean There Coffee"), or the same but for a slip of
 * one letter (two in names of at least ten letters). Names with no identifying words are never similar.
 */
export function areSimilarTenantNames(a: string, b: string): boolean {
  const left = tenantNameKey(a)
  const right = tenantNameKey(b)
  if (left === '' || right === '') return false
  if (left === right) return true

  const leftWords = left.split(' ')
  const rightWords = right.split(' ')
  const [fewer, more] = leftWords.length <= rightWords.length ? [leftWords, new Set(rightWords)] : [rightWords, new Set(leftWords)]
  if (fewer.every((word) => more.has(word)) && fewer.join('').length >= 4) return true

  const shorter = Math.min(left.length, right.length)
  if (shorter < 5) return false
  return editDistance(left, right) <= (shorter >= 10 ? 2 : 1)
}
