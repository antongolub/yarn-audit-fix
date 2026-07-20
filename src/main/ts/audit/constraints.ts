import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  engines,
  license,
  type Condition,
  type ConditionContext,
} from 'lockgraph/complete'
import sv from 'semver'

import { attempt, getWorkspaces, readJson } from '../util'

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
 *   - `floor`                   → `>=<highest engine floor the installed tree +
 *     root already require>` (read from `node_modules` / root `package.json`,
 *     local, no network) — "don't let a fix raise the tree's engine floor"
 *   - `<range>`                 → verbatim (validated as a semver range)
 * Returns `undefined` when nothing is set, so the completion runs constraint-free
 * (zero behavioural change for callers that don't opt in). Throws on an invalid
 * range, an unsupported keyword, an undiscoverable runtime, or an uncomputable floor.
 */
export const resolveEngineTargets = (
  raw: unknown,
  cwd?: string,
): TEngineTargets | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: TEngineTargets = {}
  for (const [engine, value] of Object.entries(raw as Record<string, unknown>)) {
    if (FORBIDDEN.has(engine) || !SAFE_ENGINE.test(engine)) continue
    out[engine] = resolveOne(engine, value, cwd)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const resolveOne = (engine: string, value: unknown, cwd?: string): string => {
  if (value === true || value === 'runtime') {
    const current = process.versions[engine as keyof NodeJS.ProcessVersions]
    if (!current)
      throw new Error(
        `--engines.${engine}: no runtime version to infer from; pass an explicit range (e.g. --engines.${engine}='>=18')`,
      )
    return `>=${current}`
  }
  if (value === 'floor') return computeEngineFloor(engine, cwd)
  const range = String(value)
  if (!sv.validRange(range))
    throw new Error(
      `--engines.${engine}: "${range}" is not a valid semver range`,
    )
  return range
}

/** Immediate package dirs under a `node_modules` (top-level + one scope level). */
const listPackageDirs = (nodeModules: string): string[] => {
  const out: string[] = []
  for (const entry of fs.readdirSync(nodeModules)) {
    if (entry.startsWith('.')) continue
    const full = path.join(nodeModules, entry)
    if (entry.startsWith('@')) {
      try {
        for (const member of fs.readdirSync(full)) out.push(path.join(full, member))
      } catch {
        /* not a readable scope dir */
      }
    } else {
      out.push(full)
    }
  }
  return out
}

/**
 * Infer an engine target from what the project already requires: the HIGHEST
 * lower-bound of `engines[engine]` across the root `package.json`, every workspace
 * `package.json` (monorepo), and every (hoisted) package in `node_modules`. All
 * sources are optional/best-effort — the root alone suffices, and files are read
 * only when present (local, no network). So a fix is accepted only if its closure
 * runs on the Node the tree already needs — it must not RAISE that floor.
 */
const computeEngineFloor = (engine: string, cwd?: string): string => {
  if (!cwd)
    throw new Error(
      `--engines.${engine}=floor needs the project dir; pass an explicit range (e.g. --engines.${engine}='>=18')`,
    )
  const rootFile = path.join(cwd, 'package.json')
  const root = attempt(() => readJson(rootFile)) ?? {}
  // root + workspace manifests (globbed from root `workspaces`) + hoisted deps
  const files = [rootFile, ...getWorkspaces(cwd, root)]
  try {
    for (const dir of listPackageDirs(path.join(cwd, 'node_modules')))
      files.push(path.join(dir, 'package.json'))
  } catch {
    /* node_modules absent → root + workspaces alone */
  }
  let floor: string | undefined
  for (const file of files) {
    const declared = attempt(() => readJson(file))?.engines?.[engine]
    if (typeof declared !== 'string') continue
    const lo = sv.minVersion(declared)
    if (lo && (!floor || sv.gt(lo.version, floor))) floor = lo.version
  }
  if (!floor)
    throw new Error(
      `--engines.${engine}=floor: nothing in the project declares engines.${engine} — pass an explicit range (e.g. --engines.${engine}='>=18')`,
    )
  return `>=${floor}`
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

/** The package-format axis, e.g. `cjs`. */
export type TPackageType = 'cjs'

/** Resolve `--package-type`. v1 accepts `cjs` (keep the closure require-able);
 *  anything else is an explicit error rather than a silent no-op. */
export const resolvePackageType = (raw: unknown): TPackageType | undefined => {
  if (raw === undefined || raw === null || raw === false || raw === '') return undefined
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
      | { type?: unknown; main?: unknown; exports?: unknown }
      | undefined
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
