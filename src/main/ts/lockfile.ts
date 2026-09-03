import path from 'node:path'

import {
  detect,
  LockfileError,
  parse as lfParse,
  refurbish as lfRefurbish,
  stringify as lfStringify,
} from 'lockgraph'
import type {
  Condition,
  FormatId,
  Graph,
  NodeId,
  OverrideConstraint,
  PmConfigEvidence,
} from 'lockgraph'
import sv from 'semver'

import {
  buildRegistry,
  buildTarballSource,
  ecosystemFor,
} from './audit/adapter'
import {
  buildConstraints,
  describeConstraints,
  resolveEngineTargets,
  resolveLicensePolicy,
  resolvePackageType,
} from './audit/constraints'
import type { TEngineTargets } from './audit/constraints'
import { parsePackageRules } from './audit/filter'
import { resolveScope } from './audit/scope'
import { applyBatch, applyConstrained } from './audit/apply'
import { gateByConsumers, gateByManifest, planUpgrades } from './audit/plan'
import type { ApplyDeps } from './audit/apply'
import { buildSummary, renderReport } from './audit/report'
import type { ConstraintSkip, Ledger, Plan } from './audit/report'
import { auditViaRegistry } from './audit/registry'
import {
  TAuditReport,
  TContext,
  TLockfileObject,
  TLockfileType,
  TManifestEdit,
} from './ifaces'
import { attempt, getWorkspaces, readJson } from './util'

export const getLockfileType = (lockfile: string): TLockfileType =>
  detect(lockfile)

type OverrideOrigin = NonNullable<OverrideConstraint['origin']>

// Split an override key into package segments, re-merging a scope onto the next
// segment (`@scope/pkg` is one package, not `@scope` then `pkg`), and dropping the
// `**` wildcard. yarn keys separate on `/`, pnpm on `>`.
const overrideSegments = (key: string, sep: '/' | '>'): string[] => {
  const raw = key.split(sep)
  const segs: string[] = []
  for (let i = 0; i < raw.length; i++) {
    if (sep === '/' && raw[i].startsWith('@') && i + 1 < raw.length) {
      segs.push(`${raw[i]}/${raw[i + 1]}`)
      i++
    } else segs.push(raw[i])
  }
  return segs.filter((s) => s && s !== '**')
}

// A flat `{ "a/b": "1", "foo": "2" }` block (yarn `resolutions` `/`, pnpm `>`) — the
// last segment is the pinned package, the rest its parent path.
const flatOverrides = (
  block: Record<string, unknown>,
  sep: '/' | '>',
  origin: OverrideOrigin,
): OverrideConstraint[] =>
  Object.entries(block).flatMap(([key, to]) => {
    if (typeof to !== 'string') return []
    const segs = overrideSegments(key, sep)
    return segs.length === 0
      ? []
      : [
          {
            name: segs[segs.length - 1],
            parentPath: segs.slice(0, -1),
            to,
            origin,
          },
        ]
  })

// npm's nested `{ foo: { bar: "1" } }` → one constraint per leaf, parents accumulated.
const nestedOverrides = (
  block: Record<string, unknown>,
  parents: string[],
): OverrideConstraint[] =>
  Object.entries(block).flatMap(([key, val]) =>
    typeof val === 'string'
      ? [{ name: key, parentPath: parents, to: val, origin: 'npm' as const }]
      : val && typeof val === 'object'
        ? nestedOverrides(val as Record<string, unknown>, [...parents, key])
        : [],
  )

/**
 * The project's declared overrides as a `PmConfigEvidence` policy, so `parse` captures
 * them onto the graph (`graph.overrides()` then carries the pins) per ecosystem — npm
 * `overrides`, yarn/bun `resolutions`, pnpm `pnpm.overrides`. Absent block → `undefined`
 * (parse runs override-free, identical to before). 0.6.1's `captureOverrides` is
 * internal, so we build the `OverrideConstraint[]` here.
 */
const toPolicy = (
  manifest: Record<string, any> | undefined,
  ecosystem: ReturnType<typeof ecosystemFor>,
): PmConfigEvidence | undefined => {
  if (!manifest) return undefined
  let overrides: OverrideConstraint[] = []
  let manager: PmConfigEvidence['manager']
  if (ecosystem === 'yarn-classic' || ecosystem === 'yarn-berry') {
    manager = 'yarn'
    if (manifest.resolutions)
      overrides = flatOverrides(manifest.resolutions, '/', 'yarn')
  } else if (ecosystem === 'pnpm') {
    manager = 'pnpm'
    if (manifest.pnpm?.overrides)
      overrides = flatOverrides(manifest.pnpm.overrides, '>', 'pnpm')
  } else {
    manager = 'npm'
    if (manifest.overrides) overrides = nestedOverrides(manifest.overrides, [])
  }
  return overrides.length > 0
    ? {
        kind: 'pm-config',
        manager,
        version: '0.0.0',
        source: 'package.json',
        surface: 'overrides',
        coverage: 'complete',
        overrides,
      }
    : undefined
}

export const _parse = (
  lockfile: string,
  lockfileType: TLockfileType,
  workspaceRoot?: string,
  manifest?: Record<string, any>,
): TLockfileObject => {
  if (lockfileType === undefined) {
    throw new Error('Unsupported lockfile format')
  }
  // cwd lets the berry adapter resolve builtin patch hashes; without it, re-serialised
  // patch entries break `yarn install`. `sources.policy` supplies the project's declared
  // overrides/resolutions so the graph carries them (Bug #99: the yarn family also needs
  // them at parse to bind a `resolutions`-pinned edge before completion runs).
  const policy = toPolicy(manifest, ecosystemFor(lockfileType))
  return lfParse(lockfile, lockfileType as FormatId, {
    cwd: workspaceRoot,
    sources: policy ? { policy } : undefined,
  })
}

export const _format = (
  lockfile: TLockfileObject,
  lockfileType: TLockfileType,
): string => {
  if (lockfileType === undefined) {
    throw new Error('Unsupported lockfile format')
  }
  // The project's declared overrides re-emit automatically from the graph (0.6.1 carries
  // them through parse→mutate), so a PM that stores them in the lock (pnpm's `overrides:`)
  // round-trips clean — no explicit option needed (stringify dropped it).
  try {
    // stringify is STRICT by default: a projection loss fails closed instead of silently
    // emitting a frozen-invalid lock. Keep that net.
    return lfStringify(lockfile as Graph, lockfileType as FormatId)
  } catch (e) {
    // The one loss yaf accepts: `ENRICH_REQUIRED` means every loss is *recoverable*
    // — a berry-zip `checksum` `refurbish` couldn't fill (no fetchable tarball, or a
    // bare-era yarn 2/3 lock). That's yaf's documented deferred-checksum model: emit
    // the lock and let the user finish with `yarn install` (`refurbish` already
    // reported it). Any other error (e.g. `IRREDUCIBLE_LOSS`) still fails closed.
    if (e instanceof LockfileError && e.code === 'ENRICH_REQUIRED')
      return lfStringify(lockfile as Graph, lockfileType as FormatId, {
        strict: false,
      })
    throw e
  }
}

/** A manifest file whose direct-dep ranges the gate consults, paired with its
 *  parsed content. `file` is where a --force rewrite lands. */
type TManifestFile = { file: string; manifest: Record<string, any> }

/**
 * The manifest files the gate consults: the root package.json + every workspace
 * package.json (monorepo, discovered from the root `workspaces` globs). The root
 * reuses the already-parsed `ctx.manifest`; each workspace is read best-effort (an
 * unreadable one is skipped). Absent cwd (direct/test calls) → the root alone.
 */
const collectManifestFiles = (
  cwd: string | undefined,
  rootManifest: Record<string, any> | undefined,
): TManifestFile[] => {
  const root = rootManifest ?? {}
  if (!cwd) return [{ file: 'package.json', manifest: root }]
  const files: TManifestFile[] = [
    { file: path.join(cwd, 'package.json'), manifest: root },
  ]
  for (const wf of getWorkspaces(cwd, root)) {
    const manifest = attempt(() => readJson(wf))
    if (manifest && typeof manifest === 'object')
      files.push({ file: wf, manifest })
  }
  return files
}

/**
 * Direct-dep declared ranges across the root + workspace manifests, keyed by name
 * → every `{ range, file }` that declares it (first of dependencies →
 * devDependencies → optionalDependencies → peerDependencies wins *within* one
 * manifest; separate entries *across* manifests). The gate consults these: a DIRECT
 * dep whose declared range can't admit the fix is flagged (default) or rewritten in
 * that file (--force). Non-semver ranges (`workspace:`, `npm:` alias, git/file, `*`)
 * are left alone by the caller's `sv.validRange` guard.
 */
const manifestDirectRanges = (
  files: TManifestFile[],
): Map<string, { range: string; file: string }[]> => {
  const out = new Map<string, { range: string; file: string }[]>()
  for (const { file, manifest } of files) {
    const seen = new Set<string>() // first-field-wins within this manifest
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      const deps = manifest?.[field]
      if (deps && typeof deps === 'object')
        for (const [name, range] of Object.entries(deps))
          if (typeof range === 'string' && !seen.has(name)) {
            seen.add(name)
            const list = out.get(name) ?? []
            list.push({ range, file })
            out.set(name, list)
          }
    }
  }
  return out
}

/** Report suffix naming the manifest file — empty for the root, `in <rel>` for a
 *  workspace, so a monorepo skip/rewrite says which package.json it means. */

/**
 * Upgrade every vulnerable node to the lowest published version that clears its
 * advisory — then pull in that version's *new* transitive dependency closure so
 * the lockfile stays complete. Versions resolve from the registry packument
 * (no shell-out); `replaceVersion` rebinds, `completeTransitives` fills the new
 * deps, `pruneOrphans` retires the old closure the upgrade stranded. Async since
 * the registry is hit over HTTP.
 */

type Policy = {
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
const resolvePolicy = (ctx: TContext): Policy => {
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

export const _patch = async (
  lockfile: TLockfileObject,
  report: TAuditReport,
  ctx: TContext,
  lockfileType: TLockfileType,
  overrides: readonly OverrideConstraint[] = [],
): Promise<TLockfileObject> => {
  const { flags } = ctx
  const { constraints, constraintSummary, engineTargets, onConflict } =
    resolvePolicy(ctx)
  if (Object.keys(report).length === 0) {
    ctx.summary = {
      dryRun: !!flags['dry-run'],
      upgraded: [],
      skipped: [],
      excluded: [],
      noFix: [],
    }
    !flags.silent && !flags.json && console.log('Audit check found no issues')
    return lockfile
  }

  let graph = lockfile as Graph
  const registry = buildRegistry(ctx, ecosystemFor(lockfileType))
  const excludeRules = parsePackageRules(flags.exclude)
  const excluded = new Set<string>()
  const noFix = new Set<string>()
  const incompatible = new Map<string, Set<string>>()
  // A root override/resolution the fix can't satisfy is authoritative: mirror
  // `npm audit fix --force`, which leaves such a pin untouched (never rewrites it)
  // and leaves the package flagged. spec → the pinned target (for the report).
  const pinned = new Map<string, string>()
  // A DIRECT dep (declared in the root OR a workspace package.json) whose range
  // can't admit the fix. Default → flag it (`manifestPinned`: name → the blocking
  // declarations). --force → rewrite the range in each declaring file
  // (`manifestEdits`, applied per-file by patchLockfile).
  const manifestFiles = collectManifestFiles(ctx.cwd, ctx.manifest)
  const directRanges = manifestDirectRanges(manifestFiles)
  // Fix scope (`--production` / `--workspace`): the set of node ids reachable from
  // the scoped roots. `undefined` ⇒ no scope flag ⇒ no filtering (unchanged). A
  // vulnerable node outside it is left for a deliberate, unscoped run and reported.
  const inScope = resolveScope(flags, graph, manifestFiles, ctx.cwd)
  const scopeSkipped = new Set<string>()
  const manifestPinned = new Map<string, { range: string; file: string }[]>()
  const manifestEdits: TManifestEdit[] = []
  // A fix skipped because its completed closure can't satisfy an active constraint
  // (engines or license) for some new transitive (COMPLETION_NO_CANDIDATE). Keyed
  // by "name@ver → fix", value = the diagnostic payload (depName / range / rejected).
  const constraintSkipped = new Map<string, ConstraintSkip>()

  const ledger: Ledger = {
    excluded,
    noFix,
    scopeSkipped,
    pinned,
    incompatible,
    manifestPinned,
    constraintSkipped,
    manifestEdits,
  }

  // Lowest published version that clears the advisory (minimal bump), read from
  // the registry packument.
  const packCache = new Map<
    string,
    Awaited<ReturnType<typeof registry.packument>>
  >()
  const lowestFix = async (
    name: string,
    range: string,
  ): Promise<string | undefined> => {
    if (!packCache.has(name))
      packCache.set(name, await registry.packument(name))
    const pack = packCache.get(name)
    if (!pack) return undefined
    return Object.keys(pack.versions)
      .filter((v) => sv.valid(v) && sv.satisfies(v, range))
      .sort(sv.compare)[0] // undefined ⇒ nothing published clears it
  }

  const plans = await planUpgrades(
    graph,
    report,
    ctx,
    overrides,
    inScope,
    excludeRules,
    lowestFix,
    ledger,
  )
  const gatedPlans = gateByManifest(plans, directRanges, flags, ledger)
  if (manifestEdits.length > 0) ctx.manifestEdits = manifestEdits
  const upgrades = gateByConsumers(graph, gatedPlans, flags, ledger)

  // Apply: rebind each vulnerable range to its fix, complete the new transitive
  // closure, then drop whatever got orphaned. `applied` is the set that actually
  // lands — identical to `upgrades` unless the engine gate below drops one.
  const applied: Plan[] = []
  const completionDiagnostics: {
    severity: string
    code: string
    message: string
  }[] = []
  // Live count of nodes pulled in (the slow part — a packument fetch each).
  let completed = 0
  const onCompletionDiag = (d: { code?: string }): void => {
    if (d.code === 'COMPLETION_NODE_ADDED')
      ctx.progress?.label(`Completing the tree… ${++completed}`)
  }
  // Honor the project's declared pins: a NEW closure edge governed by an override
  // binds the pinned target verbatim (before the registry rung), so the completed
  // tree never contradicts `overrides`/`resolutions`.
  const overrideList = [...overrides]

  const applyDeps: ApplyDeps = {
    target: lockfileType as FormatId,
    registry,
    overrideList,
    onCompletionDiag,
  }
  const outcome =
    constraints.length === 0
      ? await applyBatch(graph, upgrades, applyDeps)
      : await applyConstrained(
          graph,
          upgrades,
          applyDeps,
          { constraints, constraintSummary, onConflict },
          constraintSkipped,
        )
  graph = outcome.graph
  applied.push(...outcome.applied)
  completionDiagnostics.push(...outcome.diagnostics)

  ctx.summary = buildSummary(!!flags['dry-run'], ledger, applied, report)

  if (!flags.silent && !flags.json)
    renderReport(
      ctx,
      { constraintSummary, engineTargets },
      ledger,
      applied,
      report,
      inScope,
      completionDiagnostics,
    )

  return graph
}

/** Node ids present in `next` but not in `base` — everything the patch introduced. */
const addedNodes = (base: Graph, next: Graph): ReadonlySet<NodeId> => {
  const before = new Set<NodeId>()
  for (const n of base.nodes()) before.add(n.id)
  const added = new Set<NodeId>()
  for (const n of next.nodes()) if (!before.has(n.id)) added.add(n.id)
  return added
}

/**
 * Fill install-required fields the patched graph still lacks, so the written
 * lockfile needs no reconcile `yarn install`. Today that's only the yarn-berry
 * zip `checksum`: `completeTransitives` resolves new nodes' `integrity` from the
 * packument, but the berry `checksum` is a hash of yarn's *own* zip, derivable
 * only from the tarball bytes — so `refurbish` fetches them and recomputes
 * (byte-identical to what `yarn install` would write). yarn-classic nodes are
 * already complete (resolved + integrity), so it's a no-op there. Async (HTTP).
 *
 * Scoped to what the patch introduced (`base` = the pre-patch graph). A checksum
 * missing from the INPUT lock is yarn's own doing, not a gap to close: yarn only
 * records checksums for packages it actually fetched, so a platform-gated optional
 * dep (`conditions: os=… & cpu=…`) is deliberately left bare. Filling those makes
 * the next `yarn install` strip them right back out — a dirty lockfile for no gain.
 * Omit `base` to refurbish every node (standalone use).
 */
export const _refurbish = async (
  lockfile: TLockfileObject,
  lockfileType: TLockfileType,
  ctx: TContext,
  base?: TLockfileObject,
): Promise<TLockfileObject> => {
  if (lockfileType === undefined) {
    throw new Error('Unsupported lockfile format')
  }
  if (!lockfileType.startsWith('yarn-berry')) return lockfile

  const source = buildTarballSource(ctx, ecosystemFor(lockfileType))
  // Live count of recomputed checksums — the tarball fetches are the slowest
  // phase, so surface progress as each one lands.
  let filled = 0
  const result = await lfRefurbish(
    lockfile as Graph,
    lockfileType as FormatId,
    source,
    {
      seed: base && addedNodes(base as Graph, lockfile as Graph),
      onDiagnostic: (d: { code?: string }) => {
        if (d.code === 'ENRICH_FIELD_FILLED')
          ctx.progress?.label(`Recomputing checksums… ${++filled}`)
      },
    },
  )

  if (!ctx.flags.silent) {
    const warn = ctx.progress ? ctx.progress.log : console.warn
    // `unresolved` carries *every* diagnostic, including successful fills — so
    // surface only genuine gaps: a node whose checksum couldn't be recomputed
    // (git / private / workspace deps with no fetchable tarball). Those still
    // need a real `yarn install` to finish the lockfile.
    const deferred = result.unresolved.filter(
      (d) => d.code === 'ENRICH_CHECKSUM_DEFERRED',
    )
    if (deferred.length > 0) {
      warn(
        `Could not compute checksums for ${deferred.length} package(s) with no fetchable tarball — run \`yarn install\` to finish the lockfile:`,
      )
      reportDiagnostics(deferred, ctx.flags.verbose, warn)
    }
  }

  return result.graph as TLockfileObject
}

/**
 * Print graph diagnostics: one count per code, or per-entry on verbose. mutate()
 * re-emits parse-time noise (hundreds of lines), so collapse it unless asked.
 */
const reportDiagnostics = (
  diagnostics: readonly { severity: string; code: string; message: string }[],
  verbose?: boolean,
  log: (line: string) => void = console.warn,
): void => {
  if (diagnostics.length === 0) return

  if (verbose) {
    for (const d of diagnostics) {
      log(`  [${d.severity}] ${d.code}: ${d.message}`)
    }
    return
  }

  const counts = new Map<string, number>()
  for (const d of diagnostics) {
    counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  }
  for (const [code, n] of counts) {
    log(`  ${n}× ${code}${n > 1 ? ' (run with --verbose for details)' : ''}`)
  }
}

/**
 * Fetch advisories straight from the registry (npm bulk endpoint) for the parsed
 * graph — no `(yarn|npm) audit` child process. Registry / scope / auth resolve
 * from `.npmrc` / `.yarnrc.yml` / `.yarnrc` + env. Async: HTTP can't be done
 * synchronously without spawning, which is exactly what we're moving away from.
 */
export const _audit = (
  graph: Graph,
  ctx: TContext,
  lockfileType: TLockfileType,
): Promise<TAuditReport> =>
  auditViaRegistry(graph, ctx, ecosystemFor(lockfileType))

// Exposed for test spies.
export const _internal = {
  _parse,
  _audit,
  _patch,
  _refurbish,
  _format,
}

export const parse: typeof _parse = (...args) => _internal._parse(...args)
export const audit: typeof _audit = (...args) => _internal._audit(...args)
export const patch: typeof _patch = (...args) => _internal._patch(...args)
export const refurbish: typeof _refurbish = (...args) =>
  _internal._refurbish(...args)
export const format: typeof _format = (...args) => _internal._format(...args)
