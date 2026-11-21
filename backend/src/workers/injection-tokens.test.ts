import 'reflect-metadata'

import { MODULE_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants'
import { describe, expect, it } from 'vitest'

import { AppModule } from '../app.module'
import { WorkersModule } from './workers.module'

type Ctor = abstract new (...args: never[]) => unknown

/** Every class provider reachable from `root`, following module imports. */
function classProviders(root: object): Set<Ctor> {
  const seen = new Set<object>()
  const found = new Set<Ctor>()
  const addProviders = (providers: unknown[]) => {
    for (const provider of providers) {
      if (typeof provider === 'function') found.add(provider as Ctor)
      else if (provider && typeof provider === 'object' && 'useClass' in provider) found.add((provider as { useClass: Ctor }).useClass)
    }
  }
  const visit = (mod: unknown) => {
    if (!mod || seen.has(mod as object)) return
    seen.add(mod as object)
    // A dynamic module ({ module, providers, imports }) carries its own lists besides the class's static metadata.
    if (typeof mod === 'object') {
      const dynamic = mod as { module?: object; providers?: unknown[]; imports?: unknown[] }
      addProviders(dynamic.providers ?? [])
      for (const imported of dynamic.imports ?? []) visit(imported)
      visit(dynamic.module)
      return
    }
    if (typeof mod !== 'function') return
    addProviders((Reflect.getMetadata(MODULE_METADATA.PROVIDERS, mod) ?? []) as unknown[])
    for (const imported of (Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) ?? []) as unknown[]) visit(imported)
  }
  visit(root)
  return found
}

/**
 * A constructor parameter typed with a type alias (Pick<…>, Omit<…>, an interface) is erased to `Object` in decorator
 * metadata, and Nest then refuses to start the whole process. On 21 Nov 2026 this kept the worker (every queue,
 * statement processing included) from starting. Such a parameter needs an explicit @Inject(token).
 */
describe('dependency injection tokens', () => {
  // register() only assembles the provider list; the env values are never read here.
  const worker = WorkersModule.register({ LOG_LEVEL: 'silent' } as Parameters<typeof WorkersModule.register>[0])
  for (const [name, root] of [['api', AppModule], ['worker', worker]] as const) {
    it(`every constructor parameter of the ${name} providers resolves to a token`, () => {
      const unresolved: string[] = []
      for (const provider of classProviders(root)) {
        const types = (Reflect.getMetadata('design:paramtypes', provider) ?? []) as unknown[]
        const injected = new Set(((Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, provider) ?? []) as { index: number }[]).map((d) => d.index))
        types.forEach((type, index) => {
          if (!injected.has(index) && (type === Object || type === undefined)) unresolved.push(`${provider.name} parameter ${index}`)
        })
      }
      expect(unresolved).toEqual([])
    })
  }
})
