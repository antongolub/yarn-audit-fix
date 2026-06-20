import type { RegistryAdapter } from '@antongolub/lockfile/registry'
import { liveRegistry } from '@antongolub/lockfile/registry'

import { TContext } from '../ifaces'
import { resolveRegistryConfig } from './config'

/**
 * A `@antongolub/lockfile` `RegistryAdapter` (packument / resolve) for the patch
 * step. Routes each package to the registry + host-bound token resolved from
 * `.npmrc` / `.yarnrc(.yml)` (scope-aware), memoizing one `liveRegistry` per
 * registry URL. Tests / offline runs inject their own adapter via `ctx.registry`.
 */
export const buildRegistry = (ctx: TContext): RegistryAdapter => {
  if (ctx.registry) return ctx.registry as RegistryAdapter

  const cfg = resolveRegistryConfig(ctx.cwd ?? process.cwd(), ctx.flags)
  const byUrl = new Map<string, RegistryAdapter>()
  const pick = (name: string): RegistryAdapter => {
    const url = cfg.registryFor(name)
    let adapter = byUrl.get(url)
    if (!adapter) {
      adapter = liveRegistry({ url, auth: cfg.tokenFor(url) })
      byUrl.set(url, adapter)
    }
    return adapter
  }

  return {
    packument: (name) => pick(name).packument(name),
    resolve: (name, range) => pick(name).resolve(name, range),
  }
}
