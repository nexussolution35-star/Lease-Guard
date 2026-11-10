/// <reference types="vite/client" />

/** Browser-exposed variables, validated in src/services/api/config.ts. Never put secrets here. */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
