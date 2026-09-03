import type { Condition } from 'lockgraph'

import {
  buildConstraints,
  describeConstraints,
  resolveLicensePolicy,
  resolvePackageType,
} from './constraints'
import { resolveEngineTargets } from './engines'
import type { TEngineTargets } from './engines'
import { TContext } from '../ifaces'

export type Policy = {
  constraints: readonly Condition[]
  constraintSummary: string
  engineTargets: TEngineTargets | undefined
  onConflict: 'skip' | 'stop'
}

/**
 * Resolve the opt-in remediation constraints up front, before any network work — a
 * bad range or unsupported keyword throws here. Empty `constraints` ⇒ completion runs
 * exactly as it did before the gates existed.
 *
 * `--safe` is the opposite of `--force`: it FILLS the axes you didn't set — hold the
 * tree's engine floor if it declares one, keep the closure require-able in a CommonJS
 * project — but never overrides an axis you set explicitly. License stays yours.
 */
export const resolvePolicy = (ctx: TContext): Policy => {
  const { flags } = ctx
  if (flags.safe && flags.force)
    throw new Error('--safe and --force are opposites; pass one, not both')
  let engineTargets = resolveEngineTargets(flags.engines, ctx.cwd)
  let packageType = resolvePackageType(flags['package-type'])
  if (flags.safe) {
    if (!engineTargets) {
      try {
        engineTargets = resolveEngineTargets({ node: 'floor' }, ctx.cwd)
      } catch {
        /* nothing declares engines.node → no floor to hold, best-effort */
      }
    }
    if (!packageType && (ctx.manifest as { type?: unknown })?.type !== 'module')
      packageType = 'cjs'
  }
  const licensePolicy = resolveLicensePolicy(flags.license)
  return {
    constraints: buildConstraints(engineTargets, licensePolicy, packageType),
    constraintSummary: describeConstraints(
      engineTargets,
      licensePolicy,
      packageType,
    ),
    engineTargets,
    onConflict: flags['on-conflict'] === 'stop' ? 'stop' : 'skip',
  }
}
