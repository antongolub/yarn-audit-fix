import process from 'node:process'

import { engines, license, type Condition } from '@antongolub/lockfile/complete'
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

/** An SPDX allow/deny policy for the license axis. */
export type TLicensePolicy = { allow?: string[]; deny?: string[] }

const splitList = (raw: unknown): string[] =>
  typeof raw === 'string'
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : Array.isArray(raw)
      ? raw.flatMap(splitList)
      : []

/**
 * Resolve `--license` into an SPDX allow/deny policy. Accepts the dot form
 * (`--license.allow=MIT,ISC --license.deny=GPL-3.0`) or a bare allow list
 * (`--license=MIT,ISC`). Returns undefined when nothing is set → no license gate.
 * v1 compares single SPDX ids; an SPDX expression (`(MIT OR Apache-2.0)`) is
 * unevaluable and, under the lib's default `onUnevaluable:'reject'`, is flagged
 * rather than silently accepted (opt-in ⇒ guarantee-or-flag).
 */
export const resolveLicensePolicy = (
  raw: unknown,
): TLicensePolicy | undefined => {
  if (raw === undefined || raw === null || raw === false) return undefined
  const obj = typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  const allow = splitList(obj ? obj.allow : raw)
  const deny = splitList(obj ? obj.deny : undefined)
  if (allow.length === 0 && deny.length === 0) return undefined
  const policy: TLicensePolicy = {}
  if (allow.length > 0) policy.allow = allow
  if (deny.length > 0) policy.deny = deny
  return policy
}

/** Readable license-policy summary: `allow MIT, ISC / deny GPL-3.0`. */
export const describeLicensePolicy = (p: TLicensePolicy): string =>
  [
    p.allow?.length ? `allow ${p.allow.join(', ')}` : '',
    p.deny?.length ? `deny ${p.deny.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' / ')

/**
 * Build the `@antongolub/lockfile` `constraints` array threaded into
 * `completeTransitives`. Engine gates are lenient (npm parity: a package that
 * declares no `engines` is accepted — a missing declaration is not a claim of
 * incompatibility). License gates need a `manifest()`-capable registry (liveRegistry).
 * Empty when nothing is set → the completion is unchanged.
 */
export const buildConstraints = (
  engineTargets: TEngineTargets | undefined,
  licensePolicy?: TLicensePolicy,
): Condition[] => [
  ...(engineTargets ? [engines(engineTargets, { mode: 'lenient' })] : []),
  ...(licensePolicy ? [license(licensePolicy)] : []),
]

/** Combined one-line summary of every active axis, for the report header. */
export const describeConstraints = (
  engineTargets: TEngineTargets | undefined,
  licensePolicy: TLicensePolicy | undefined,
): string =>
  [
    engineTargets ? describeEngineTargets(engineTargets) : '',
    licensePolicy ? `license ${describeLicensePolicy(licensePolicy)}` : '',
  ]
    .filter(Boolean)
    .join('; ')
