import { defineConfig } from 'vitest/config'

export default defineConfig({
  // NestJS dependency injection reads constructor types from decorator metadata.
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  // Tests compile @leaseguard/domain from source, so they never depend on a stale build.
  resolve: { conditions: ['@leaseguard/source'] },
  ssr: { resolve: { conditions: ['@leaseguard/source'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
