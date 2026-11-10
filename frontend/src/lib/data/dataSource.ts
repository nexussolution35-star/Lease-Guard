/**
 * A source created on first use and cached. Factories are lazy so the API and Supabase clients are
 * only constructed when a screen first needs data (never at import time, e.g. in unit tests).
 */
export function lazySource<TSource>(create: () => TSource): () => TSource {
  let source: TSource | undefined
  return () => {
    source ??= create()
    return source
  }
}
