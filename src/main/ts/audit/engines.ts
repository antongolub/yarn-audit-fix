import fs from 'node:fs'
import path from 'node:path'

import sv from 'semver'

import process from 'node:process'

import { attempt, getWorkspaces, readJson } from '../util'

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
  for (const [engine, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
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
        for (const member of fs.readdirSync(full))
          out.push(path.join(full, member))
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
