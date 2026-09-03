import {
  engines,
  license,
  type Condition,
  type ConditionContext,
} from 'lockgraph'

import { describeEngineTargets } from './engines'
import type { TEngineTargets } from './engines'

// Engine resolution lives in ./engines; re-exported so `constraints` stays the one
// import for the whole remediation policy surface.
export { describeEngineTargets, resolveEngineTargets } from './engines'
export type { TEngineTargets } from './engines'

// Engine keys are simple identifiers (`node`, `npm`, `yarn`, `vscode`…). Guard the
// minimist-nested `--engines.<engine>` object against prototype-pollution keys
// (`__proto__`, `constructor`, `prototype`) and anything not identifier-shaped
// before we ever index `process.versions` or build a constraint from it.

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
  const obj =
    typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
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

/** The package-format axis, e.g. `cjs`. */
export type TPackageType = 'cjs'

/** Resolve `--package-type`. v1 accepts `cjs` (keep the closure require-able);
 *  anything else is an explicit error rather than a silent no-op. */
export const resolvePackageType = (raw: unknown): TPackageType | undefined => {
  if (raw === undefined || raw === null || raw === false || raw === '')
    return undefined
  if (raw === 'cjs') return 'cjs'
  throw new Error(
    `--package-type: "${String(raw)}" is not supported (only "cjs" for now)`,
  )
}

/**
 * A custom Condition (the lib deliberately ships no module-format built-in — true
 * `require(ESM)` compatibility is per-edge and Node-gated, so this is a node-local
 * *approximation*): reject an **ESM-only** package for a CommonJS consumer. A
 * package with `type !== 'module'` is CJS by default (requireable); an ESM one
 * passes only if it still exposes a CJS entry — a `main`, or a `require`/`default`
 * export condition. Reads the full manifest (corgi omits `type`/`exports`) → cost 10,
 * so cheaper axes (engines) reject first. It checks *consistency of entry points*,
 * not runtime behaviour, which yaf can't verify — but a fix that flips a dep
 * ESM-only breaks every `require()` of it, and that we can catch.
 */
const commonjsCompatible = (): Condition => ({
  kind: 'commonjs',
  cost: 10,
  async evaluate(ctx: ConditionContext) {
    const m = (await ctx.manifest()) as
      { type?: unknown; main?: unknown; exports?: unknown } | undefined
    if (m === undefined)
      return { ok: 'unevaluable', reason: 'no manifest()-capable registry' }
    if (m.type !== 'module') return { ok: true } // CJS by default → requireable
    const hasCjsEntry =
      typeof m.main === 'string' ||
      /"(require|default)"\s*:/.test(JSON.stringify(m.exports ?? null))
    return hasCjsEntry
      ? { ok: true }
      : { ok: false, reason: `${ctx.name}@${ctx.version} is ESM-only` }
  },
})

/**
 * Build the `lockgraph` `constraints` array threaded into
 * `completeTransitives`. Engine gates are lenient (npm parity: a package that
 * declares no `engines` is accepted — a missing declaration is not a claim of
 * incompatibility). License + package-type gates need a `manifest()`-capable
 * registry (liveRegistry). Empty when nothing is set → the completion is unchanged.
 */
export const buildConstraints = (
  engineTargets: TEngineTargets | undefined,
  licensePolicy?: TLicensePolicy,
  packageType?: TPackageType,
): Condition[] => [
  ...(engineTargets ? [engines(engineTargets, { mode: 'lenient' })] : []),
  ...(licensePolicy ? [license(licensePolicy)] : []),
  ...(packageType === 'cjs' ? [commonjsCompatible()] : []),
]

/** Combined one-line summary of every active axis, for the report header. */
export const describeConstraints = (
  engineTargets: TEngineTargets | undefined,
  licensePolicy: TLicensePolicy | undefined,
  packageType?: TPackageType,
): string =>
  [
    engineTargets ? describeEngineTargets(engineTargets) : '',
    licensePolicy ? `license ${describeLicensePolicy(licensePolicy)}` : '',
    packageType === 'cjs' ? 'commonjs-compatible' : '',
  ]
    .filter(Boolean)
    .join('; ')
