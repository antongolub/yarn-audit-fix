import process from 'node:process'

import { engines, type Condition } from '@antongolub/lockfile/complete'
import sv from 'semver'

// Engine keys are simple identifiers (`node`, `npm`, `yarn`, `vscode`…). Guard the
// minimist-nested `--engines.<engine>` object against prototype-pollution keys
// (`__proto__`, `constructor`, `prototype`) and anything not identifier-shaped
// before we ever index `process.versions` or build a constraint from it.
const SAFE_ENGINE = /^[a-z][\w-]*$/i
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

/** Resolved semver target range per engine, e.g. `{ node: '>=18', npm: '>=9' }`. */
export type TEngineTargets = Record<string, string>

/**
 * Resolve the `--engines.<engine>` flag object into concrete semver target
 * ranges. Value grammar per engine:
 *   - bare (`true`) / `runtime` → `>=<current process version>` (the Node the CLI
 *     runs on — cheap default; the report flags that this may differ from the
 *     project's target Node)
 *   - `<range>`                 → verbatim (validated as a semver range)
 *   - `floor`                   → reserved (infer from the tree) — not yet wired
 * Returns `undefined` when nothing is set, so the completion runs constraint-free
 * (zero behavioural change for callers that don't opt in). Throws on an invalid
 * range, an unsupported keyword, or a runtime with no discoverable version.
 */
export const resolveEngineTargets = (
  raw: unknown,
): TEngineTargets | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: TEngineTargets = {}
  for (const [engine, value] of Object.entries(raw as Record<string, unknown>)) {
    if (FORBIDDEN.has(engine) || !SAFE_ENGINE.test(engine)) continue
    out[engine] = resolveOne(engine, value)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const resolveOne = (engine: string, value: unknown): string => {
  if (value === true || value === 'runtime') {
    const current = process.versions[engine as keyof NodeJS.ProcessVersions]
    if (!current)
      throw new Error(
        `--engines.${engine}: no runtime version to infer from; pass an explicit range (e.g. --engines.${engine}='>=18')`,
      )
    return `>=${current}`
  }
  if (value === 'floor')
    throw new Error(
      `--engines.${engine}=floor is not supported yet; pass an explicit range (e.g. --engines.${engine}='>=18') or omit the value for the runtime version`,
    )
  const range = String(value)
  if (!sv.validRange(range))
    throw new Error(
      `--engines.${engine}: "${range}" is not a valid semver range`,
    )
  return range
}

/** One-line target summary for the report: `node >=18, npm >=9`. */
export const describeEngineTargets = (targets: TEngineTargets): string =>
  Object.entries(targets)
    .map(([engine, range]) => `${engine} ${range}`)
    .join(', ')

/**
 * Build the `@antongolub/lockfile` `constraints` array threaded into
 * `completeTransitives`. Engine gates are lenient (npm parity: a package that
 * declares no `engines` is accepted — a missing declaration is not a claim of
 * incompatibility). Empty when no targets are set → the completion is unchanged.
 */
export const buildConstraints = (
  targets: TEngineTargets | undefined,
): Condition[] => (targets ? [engines(targets, { mode: 'lenient' })] : [])
