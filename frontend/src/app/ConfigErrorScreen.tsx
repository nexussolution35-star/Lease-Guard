import { BrandMark } from '@/components/shared/BrandMark'

export interface ConfigErrorScreenProps {
  issues: readonly string[]
}

/** Startup error when the frontend environment (`frontend/.env`, VITE_* variables) is invalid. */
export function ConfigErrorScreen({ issues }: ConfigErrorScreenProps) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-lg">
        <BrandMark className="mb-6" />
        <div role="alert" className="border-t border-border pt-6">
          <h1 className="flex items-center gap-2 text-base font-medium text-balance">
            <span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
            LeaseGuard is not configured correctly
          </h1>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">
            Fix these settings in the repository root <code>.env</code> (see <code>.env.example</code>) and restart the
            development server:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-6 text-sm">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  )
}
