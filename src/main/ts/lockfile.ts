import { detect, governingOverrideFor, overridesOf, parse as lfParse, stringify as lfStringify } from '@antongolub/lockfile'
import type { Graph, FormatId, Manifest, OverrideConstraint } from '@antongolub/lockfile'
import { completeTransitives, selectConstrained } from '@antongolub/lockfile/complete'
import { refurbish as lfRefurbish } from '@antongolub/lockfile/enrich'
import { replaceVersion } from '@antongolub/lockfile/modify'
import { pruneOrphans } from '@antongolub/lockfile/optimize'
import sv from 'semver'

import { buildRegistry, buildTarballSource, ecosystemFor } from './audit/adapter'
import {
  buildConstraints,
  describeConstraints,
  resolveEngineTargets,
  resolveLicensePolicy,
} from './audit/constraints'
import { matchesPackage, parsePackageRules } from './audit/filter'
import { formatAdvisoryMeta } from './audit/meta'
import { auditViaRegistry } from './audit/registry'
import {
  TAuditReport,
  TContext,
  TLockfileObject,
  TLockfileType,
  TManifestEdit,
} from './ifaces'

// NodeId isn't re-exported from the package root — derive it from a primitive.
type NodeId = Awaited<ReturnType<typeof replaceVersion>>['added'][number]

export const getLockfileType = (lockfile: string): TLockfileType =>
  detect(lockfile)

/**
 * Wrap the project's raw `package.json` override block into the lib `Manifest`
 * shape (`native.*`) keyed by workspace root, so `parse` can F6-capture the
 * project's declared pins per ecosystem — npm `overrides`, yarn/bun `resolutions`,
 * pnpm `pnpm.overrides`. Absent block → `undefined` (parse runs override-free,
 * identical to before). This is what makes `overridesOf(graph)` carry the pins.
 */
const toManifests = (
  manifest: Record<string, any> | undefined,
  ecosystem: ReturnType<typeof ecosystemFor>,
): Record<string, Manifest> | undefined => {
  if (!manifest) return undefined
  const native: NonNullable<Manifest['native']> = {}
  if (ecosystem === 'yarn-classic' || ecosystem === 'yarn-berry') {
    if (manifest.resolutions) native.yarnResolutions = manifest.resolutions
  } else if (ecosystem === 'pnpm') {
    if (manifest.pnpm?.overrides) native.pnpmOverrides = manifest.pnpm.overrides
  } else if (manifest.overrides) {
    native.npmOverrides = manifest.overrides // npm (+ bun, npm-shaped)
  }
  return Object.keys(native).length > 0 ? { '.': { native } } : undefined
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
  // workspaceRoot lets the berry adapter resolve builtin patch hashes; without
  // it, re-serialised patch entries break `yarn install`. `manifests` supplies the
  // project's declared overrides/resolutions so the graph carries them (Bug #99:
  // the yarn family also needs them at parse to bind a `resolutions`-pinned edge).
  return lfParse(lockfileType as FormatId, lockfile, {
    workspaceRoot,
    manifests: toManifests(manifest, ecosystemFor(lockfileType)),
  })
}

export const _format = (
  lockfile: TLockfileObject,
  lockfileType: TLockfileType,
  overrides: readonly OverrideConstraint[] = [],
): string => {
  if (lockfileType === undefined) {
    throw new Error('Unsupported lockfile format')
  }
  // Re-emit the project's declared overrides so a PM that stores them in the lock
  // (pnpm's `overrides:`) round-trips clean — else `--frozen-lockfile` rejects the
  // rewritten lock (CONFIG_MISMATCH). Empty → omit the option (unchanged output).
  return lfStringify(
    lockfileType as FormatId,
    lockfile as Graph,
    overrides.length > 0 ? { overrides: [...overrides] } : undefined,
  )
}

/** Strip yarn's `npm:` protocol; return a usable semver range or undefined. */
const normalizeRange = (raw?: string): string | undefined => {
  if (!raw) return undefined
  const r = raw.startsWith('npm:') ? raw.slice(4) : raw
  return sv.validRange(r) ? r : undefined
}

/**
 * Direct-dep declared ranges from the root package.json, keyed by name (first of
 * dependencies → devDependencies → optionalDependencies → peerDependencies wins).
 * The manifest gate consults these: a DIRECT dep whose range can't admit the fix is
 * flagged (default) or its range rewritten (--force). Non-semver ranges
 * (`workspace:`, `npm:` alias, git/file, `*`) are left alone by the caller's
 * `sv.validRange` guard.
 */
const manifestDirectRanges = (
  manifest: Record<string, any> | undefined,
): Map<string, string> => {
  const out = new Map<string, string>()
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const deps = manifest?.[field]
    if (deps && typeof deps === 'object')
      for (const [name, range] of Object.entries(deps))
        if (typeof range === 'string' && !out.has(name)) out.set(name, range)
  }
  return out
}

/** Widen a declared range to admit `fix`, preserving the pin operator
 * (`^`/`~`/exact; anything else → caret): `4.17.11`→`4.18.0`, `~4.1`→`~4.18.0`. */
const widenRange = (declared: string, fix: string): string => {
  const t = declared.trim()
  const op = t.startsWith('^') ? '^' : t.startsWith('~') ? '~' : /^\d/.test(t) ? '' : '^'
  return op + fix
}

/**
 * Upgrade every vulnerable node to the lowest published version that clears its
 * advisory — then pull in that version's *new* transitive dependency closure so
 * the lockfile stays complete. Versions resolve from the registry packument
 * (no shell-out); `replaceVersion` rebinds, `completeTransitives` fills the new
 * deps, `pruneOrphans` retires the old closure the upgrade stranded. Async since
 * the registry is hit over HTTP.
 */
export const _patch = async (
  lockfile: TLockfileObject,
  report: TAuditReport,
  ctx: TContext,
  lockfileType: TLockfileType,
  overrides: readonly OverrideConstraint[] = [],
): Promise<TLockfileObject> => {
  const { flags } = ctx
  // Opt-in remediation constraints (engines + license): resolve them up front (a
  // bad range / unsupported keyword throws here, before any network work).
  // `constraints` empty ⇒ the completion runs exactly as before.
  const engineTargets = resolveEngineTargets(flags.engines, ctx.cwd)
  const licensePolicy = resolveLicensePolicy(flags.license)
  const constraints = buildConstraints(engineTargets, licensePolicy)
  const constraintSummary = describeConstraints(engineTargets, licensePolicy)
  const onConflict: 'skip' | 'stop' =
    flags['on-conflict'] === 'stop' ? 'stop' : 'skip'
  if (Object.keys(report).length === 0) {
    !flags.silent && console.log('Audit check found no issues')
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
  // A DIRECT dep (declared in the root package.json) whose range can't admit the
  // fix. Default → flag it (`manifestPinned`, spec → declared range). --force →
  // rewrite the range in package.json (`manifestEdits`, applied by patchLockfile).
  const directRanges = manifestDirectRanges(ctx.manifest)
  const manifestPinned = new Map<string, string>()
  const manifestEdits: TManifestEdit[] = []
  // A fix skipped because its completed closure can't satisfy an active constraint
  // (engines or license) for some new transitive (COMPLETION_NO_CANDIDATE). Keyed
  // by "name@ver → fix", value = the diagnostic payload (depName / range / rejected).
  const constraintSkipped = new Map<
    string,
    {
      seed?: boolean // true = the fix version itself was rejected (not a transitive)
      depName?: string
      range?: string
      rejected?: readonly { version: string; by: string; reason?: string }[]
    }
  >()

  // Lowest published version that clears the advisory (minimal bump), read from
  // the registry packument.
  const packCache = new Map<string, Awaited<ReturnType<typeof registry.packument>>>()
  const lowestFix = async (
    name: string,
    range: string,
  ): Promise<string | undefined> => {
    if (!packCache.has(name)) packCache.set(name, await registry.packument(name))
    const pack = packCache.get(name)
    if (!pack) return undefined
    return Object.keys(pack.versions)
      .filter((v) => sv.valid(v) && sv.satisfies(v, range))
      .sort(sv.compare)[0] // undefined ⇒ nothing published clears it
  }

  type Plan = {
    name: string
    fromRange: string
    fix: string
    froms: { id: NodeId; version: string }[]
  }

  // Pass 1: per vulnerable package, resolve the minimal fix and the nodes to bump.
  const plans: Plan[] = []
  const advisoryCount = Object.keys(report).length
  let resolving = 0
  for (const [name, advisory] of Object.entries(report)) {
    ctx.progress?.label(`Resolving fixes… ${++resolving}/${advisoryCount}`)
    const vuln = [...graph.nodes()].filter(
      (n) =>
        n.name === name && sv.satisfies(n.version, advisory.vulnerable_versions),
    )
    if (vuln.length === 0) continue

    const kept = vuln.filter((n) => {
      if (
        excludeRules.length > 0 &&
        matchesPackage(n.name, n.version, excludeRules)
      ) {
        excluded.add(`${n.name}@${n.version}`)
        return false
      }
      return true
    })
    if (kept.length === 0) continue

    const fix = await lowestFix(name, advisory.patched_versions)
    if (fix === undefined) {
      kept.forEach((n) => noFix.add(`${n.name}@${n.version}`))
      continue
    }

    // Override authority (`npm audit fix --force` parity): a root override /
    // resolution is the user's deliberate pin. If it governs this package and the
    // fix can't satisfy its target (an exact vuln pin, or a non-semver target),
    // leave it untouched — npm does NOT rewrite an override, even with --force — and
    // report it. A range pin that ADMITS the fix falls through: the bump stays
    // within the pin, so it's safe to apply.
    if (overrides.length > 0) {
      let pinTo = governingOverrideFor(name, [], overrides)?.to // bare / tree-wide
      if (pinTo === undefined) {
        // single-parent-scoped (matches the lib's consumerPath = [immediate parent])
        pinScan: for (const n of kept) {
          for (const e of graph.in(n.id as NodeId)) {
            const consumer = graph.getNode(e.src)
            const g = consumer && governingOverrideFor(name, [consumer.name], overrides)
            if (g) {
              pinTo = g.to
              break pinScan
            }
          }
        }
      }
      // v1 safety: the lib's matcher only sees one consumer level, so a DEEP scope
      // (≥2 ancestors, e.g. npm `a>b>foo`) under-matches. We can't prove which
      // subtree it governs → treat it as authoritative-but-unverifiable and leave
      // the package be, rather than emit a bump a deep override could revert on
      // install. (Drop this once the lib threads a full consumer path.)
      const deep =
        pinTo === undefined
          ? overrides.find(
              (c) => c.package === name && (c.parentPath?.length ?? 0) >= 2,
            )
          : undefined
      if (deep !== undefined) {
        kept.forEach((n) => pinned.set(`${n.name}@${n.version}`, deep.to))
        continue
      }
      if (pinTo !== undefined) {
        // A range pin that ADMITS the fix falls through (bump stays within it);
        // an exact / non-semver pin the fix can't satisfy is left as-is.
        const pinRange = normalizeRange(pinTo)
        if (pinRange === undefined || !sv.satisfies(fix, pinRange)) {
          kept.forEach((n) => pinned.set(`${n.name}@${n.version}`, pinTo!))
          continue
        }
      }
    }

    // skip versions already at/above the fix — keeps re-runs idempotent
    const froms = kept.filter((n) => sv.lt(n.version, fix))
    if (froms.length === 0) continue

    plans.push({
      name,
      fromRange: advisory.vulnerable_versions,
      fix,
      froms: froms.map((n) => ({ id: n.id as NodeId, version: n.version })),
    })
  }

  // Manifest gate: a DIRECT dep whose declared package.json range can't admit the
  // fix. Default → flag + skip (like `npm audit fix` without --force: surface it,
  // the engineer widens the range). --force → rewrite the range in package.json
  // (npm audit fix --force parity) + let the bump proceed. Works for EVERY format:
  // a yarn-classic lock has no root edge, so Pass 2's edge gate can't see direct
  // deps — this can. Non-semver ranges (workspace:/npm:alias/git/file) skip via the
  // validRange guard; `*` admits every fix so it never trips.
  const gatedPlans: Plan[] = []
  for (const p of plans) {
    const declared = directRanges.get(p.name)
    if (declared && sv.validRange(declared) && !sv.satisfies(p.fix, declared)) {
      if (!flags.force) {
        p.froms.forEach((f) => manifestPinned.set(`${p.name}@${f.version}`, declared))
        continue
      }
      manifestEdits.push({ name: p.name, from: declared, to: widenRange(declared, p.fix) })
    }
    gatedPlans.push(p)
  }
  if (manifestEdits.length > 0) ctx.manifestEdits = manifestEdits

  // Pass 2: compat gate. Skip a fix outside a *surviving* consumer's declared
  // range (unless --force); a consumer that is itself being bumped is exempt —
  // replaceVersion + completeTransitives re-derive its deps from the registry.
  const planNames = new Set(gatedPlans.map((p) => p.name))
  const upgrades: Plan[] = []
  for (const p of gatedPlans) {
    let breaks: Set<string> | undefined
    if (!flags.force) {
      for (const from of p.froms) {
        for (const edge of graph.in(from.id)) {
          const consumer = graph.getNode(edge.src)
          if (consumer && planNames.has(consumer.name)) continue // bumped too
          const range = normalizeRange(edge.attrs?.range)
          if (range && !sv.satisfies(p.fix, range)) {
            ;(breaks ??= new Set()).add(`${edge.src} wants "${edge.attrs!.range}"`)
          }
        }
      }
    }
    if (breaks?.size) {
      incompatible.set(`${p.name}@${p.froms[0].version} → ${p.fix}`, breaks)
      continue
    }
    upgrades.push(p)
  }

  // Snapshot pre-existing danglers (in-degree 0 in the *parsed* lock) so the final
  // prune PRESERVES them: yarn's `--immutable` keeps base danglers, but an unseeded
  // prune would GC them → divergence (YN0028, e.g. redwood's `@types/keyv`). The
  // bump's own stranded closure is NOT in this set (those nodes had an edge at
  // parse → in-degree > 0), so it's still pruned. (= `pruneOrphans` mode "b".)
  const preExistingDanglers = new Set<NodeId>(
    [...graph.nodes()]
      .filter((n) => graph.in(n.id as NodeId).length === 0)
      .map((n) => n.id as NodeId),
  )

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

  if (constraints.length === 0) {
    // Default path: rebind every fix, then ONE batch completion — fast, and the
    // parallel packument prefetch batches across all upgrades.
    const recentlyAdded = new Set<NodeId>()
    const recentlyOrphaned = new Set<NodeId>()
    for (const u of upgrades) {
      const res = await replaceVersion(
        graph,
        { name: u.name, fromRange: u.fromRange },
        u.fix,
        { registry },
      )
      graph = res.graph
      res.added.forEach((id) => recentlyAdded.add(id))
      res.removed.forEach((id) => recentlyOrphaned.add(id))
      applied.push(u)
    }
    if (recentlyAdded.size > 0 || recentlyOrphaned.size > 0) {
      const completion = await completeTransitives(graph, registry, {
        seed: { recentlyAdded, recentlyOrphaned },
        overrides: overrideList,
        onDiagnostic: onCompletionDiag,
      })
      graph = completion.graph
      completionDiagnostics.push(...completion.unresolved)
      // completeTransitives is additive, so a dep-changing upgrade leaves the
      // *old* closure behind as orphans → `yarn install --immutable` would reject
      // them. Sweep with `pruneOrphans` (ref-counted), but `preserve` pre-existing
      // danglers so we never GC a node yarn keeps (fsevents patch bases, catalog:
      // targets). A yarn-classic lock has no workspace root, so this noops there.
      graph = pruneOrphans(graph, { preserve: preExistingDanglers }).graph
    }
  } else {
    // Constrained path (opt-in: engines and/or license). Apply + complete each
    // upgrade tentatively and commit it only if its closure resolves under the
    // constraints. A COMPLETION_NO_CANDIDATE means a new transitive has no
    // constraint-satisfying version in range → the fix's closure can't be completed
    // → skip the whole fix (leave the vuln, report it) or error under
    // --on-conflict=stop. replaceVersion/completeTransitives are immutable, so a
    // rejected upgrade's tentative graphs are simply dropped and `graph` is unchanged.
    let touched = false
    for (const u of upgrades) {
      const head = `${u.name}@${u.froms[0].version} → ${u.fix}`
      // Seed gate: the fix VERSION itself must pass the constraints. Completion
      // only gates the transitives it resolves, never the replaceVersion target, so
      // without this a fix that bumps a package TO an engine-/license-violating
      // version would slip through (only its deps would be checked).
      const seedSel = await selectConstrained(
        registry,
        u.name,
        u.fix,
        constraints,
        'reject',
      )
      if (!seedSel.selected) {
        if (onConflict === 'stop')
          throw new Error(
            `Constraints (${constraintSummary}): the fix ${head} itself doesn't satisfy the policy. Re-run with --on-conflict=skip to leave it, or relax the constraint.`,
          )
        constraintSkipped.set(head, {
          seed: true,
          depName: u.name,
          range: u.fix,
          rejected: seedSel.rejected,
        })
        continue
      }
      const res = await replaceVersion(
        graph,
        { name: u.name, fromRange: u.fromRange },
        u.fix,
        { registry },
      )
      if (res.added.length === 0 && res.removed.length === 0) {
        applied.push(u) // no-op bump (already at the fix); nothing to complete
        continue
      }
      const completion = await completeTransitives(res.graph, registry, {
        seed: {
          recentlyAdded: new Set(res.added),
          recentlyOrphaned: new Set(res.removed),
        },
        overrides: overrideList,
        constraints,
        onDiagnostic: onCompletionDiag,
      })
      // An override forces a version a constraint vetoes — a user-config
      // contradiction (npm parity holds the pin verbatim, but it breaks the
      // target). Nothing to skip: always hard-fail.
      const conflict = completion.unresolved.find(
        (d: { code?: string }) =>
          d.code === 'COMPLETION_OVERRIDE_CONSTRAINT_CONFLICT',
      ) as { data?: { depName?: string; forced?: string } } | undefined
      if (conflict)
        throw new Error(
          `An override pins ${conflict.data?.depName ?? '?'}@${conflict.data?.forced ?? '?'}, which violates the active constraints (${constraintSummary}). Reconcile the override or drop the constraint.`,
        )
      const noCandidate = completion.unresolved.filter(
        (d: { code?: string }) => d.code === 'COMPLETION_NO_CANDIDATE',
      ) as {
        data?: {
          depName?: string
          range?: string
          rejected?: readonly { version: string; by: string; reason?: string }[]
        }
      }[]
      if (noCandidate.length > 0) {
        if (onConflict === 'stop')
          throw new Error(
            `Constraints (${constraintSummary}): no in-range version of ${noCandidate[0].data?.depName ?? '?'} satisfies the policy for ${head}. Re-run with --on-conflict=skip to leave it, or relax the constraint.`,
          )
        constraintSkipped.set(head, noCandidate[0].data ?? {})
        continue // drop u: keep the pre-u graph, leave the vuln in place
      }
      graph = completion.graph
      completionDiagnostics.push(...completion.unresolved)
      touched = true
      applied.push(u)
    }
    if (touched)
      graph = pruneOrphans(graph, { preserve: preExistingDanglers }).graph
  }

  if (!flags.silent) {
    // Route through the spinner when one is active (clears → prints → redraws);
    // plain console otherwise (direct/test calls).
    const log = ctx.progress ? ctx.progress.log : console.log
    const warn = ctx.progress ? ctx.progress.log : console.warn
    // Surface the active constraints first — and when an engine target was inferred
    // from the running process, flag that it may differ from the project's target.
    if (constraintSummary) {
      log(`Constraints: ${constraintSummary}`)
      const runtimeEngines = engineTargets
        ? Object.keys(engineTargets).filter((e) => {
            const v = (flags.engines as Record<string, unknown> | undefined)?.[e]
            return v === true || v === 'runtime'
          })
        : []
      if (runtimeEngines.length > 0)
        log(
          `  (${runtimeEngines.join(', ')} = the running process — may differ from your project's target; pass --engines.${runtimeEngines[0]}='<range>' to pin it)`,
        )
      const floorEngines = engineTargets
        ? Object.keys(engineTargets).filter(
            (e) =>
              (flags.engines as Record<string, unknown> | undefined)?.[e] ===
              'floor',
          )
        : []
      if (floorEngines.length > 0)
        log(`  (${floorEngines.join(', ')} = inferred from the installed tree)`)
    }
    // Dedupe by from→to; annotate with severity / CVSS / CVE refs.
    const seen = new Set<string>()
    const lines: string[] = []
    for (const u of applied) {
      const head = `${u.name}@${u.froms[0].version} → ${u.fix}`
      if (seen.has(head)) continue
      seen.add(head)
      lines.push(head + formatAdvisoryMeta(report[u.name]))
    }
    lines.sort()
    if (lines.length > 0) {
      log(`Upgraded deps (${lines.length}):`)
      for (const line of lines) log(`  ${line}`)
    } else {
      log('Upgraded deps: <none>')
    }
    if (noFix.size > 0) {
      log('No fix available: ' + [...noFix].sort().join(', '))
    }
    if (excluded.size > 0) {
      log('Excluded (per --exclude): ' + [...excluded].sort().join(', '))
    }
    if (incompatible.size > 0) {
      warn(
        'Skipped (fix breaks a consumer\'s declared range; re-run with --force to apply):',
      )
      for (const [spec, consumers] of [...incompatible].sort()) {
        warn(`  ${spec}`)
        for (const c of [...consumers].sort()) warn(`    - ${c}`)
      }
    }
    if (pinned.size > 0) {
      warn(
        'Skipped (pinned by an override/resolution the fix can\'t satisfy; update the override to remediate):',
      )
      for (const [spec, to] of [...pinned].sort()) {
        warn(`  ${spec} (pinned → ${to})`)
      }
    }
    if (manifestPinned.size > 0) {
      warn(
        'Skipped (package.json pins these to a range the fix can\'t satisfy; re-run with --force to update package.json, or widen the range yourself):',
      )
      for (const [spec, range] of [...manifestPinned].sort()) {
        warn(`  ${spec} (pinned → "${range}")`)
      }
    }
    if (constraintSkipped.size > 0) {
      warn(
        `Skipped (constraints — no fix keeps the closure within the policy [${constraintSummary}]; relax it, --exclude the package, or accept the newer dep):`,
      )
      for (const [head, data] of [...constraintSkipped].sort()) {
        const need = data.seed
          ? ' — the fix version itself is not permitted'
          : data.depName
            ? ` — needs ${data.depName}${data.range ? `@${data.range}` : ''}`
            : ''
        warn(`  ${head}${need}`)
        if (flags.verbose && data.rejected?.length) {
          for (const r of data.rejected)
            warn(`    - ${data.depName}@${r.version}: ${r.reason ?? r.by}`)
        }
      }
    }
    if (manifestEdits.length > 0) {
      log('Updated package.json ranges (--force):')
      for (const e of [...manifestEdits].sort((a, b) => a.name.localeCompare(b.name))) {
        log(`  ${e.name}: "${e.from}" → "${e.to}"`)
      }
    }
    // info-level COMPLETION_NODE_ADDED is success noise — only surface real gaps.
    reportDiagnostics(
      completionDiagnostics.filter((d) => d.severity !== 'info'),
      flags.verbose,
      warn,
    )
  }

  return graph
}

/**
 * Fill install-required fields the patched graph still lacks, so the written
 * lockfile needs no reconcile `yarn install`. Today that's only the yarn-berry
 * zip `checksum`: `completeTransitives` resolves new nodes' `integrity` from the
 * packument, but the berry `checksum` is a hash of yarn's *own* zip, derivable
 * only from the tarball bytes — so `refurbish` fetches them and recomputes
 * (byte-identical to what `yarn install` would write). yarn-classic nodes are
 * already complete (resolved + integrity), so it's a no-op there. Async (HTTP).
 */
export const _refurbish = async (
  lockfile: TLockfileObject,
  lockfileType: TLockfileType,
  ctx: TContext,
): Promise<TLockfileObject> => {
  if (lockfileType === undefined) {
    throw new Error('Unsupported lockfile format')
  }
  if (!lockfileType.startsWith('yarn-berry')) return lockfile

  const source = buildTarballSource(ctx, ecosystemFor(lockfileType))
  // Live count of recomputed checksums — the tarball fetches are the slowest
  // phase, so surface progress as each one lands.
  let filled = 0
  const result = await lfRefurbish(lockfile as Graph, lockfileType as FormatId, source, {
    onDiagnostic: (d: { code?: string }) => {
      if (d.code === 'ENRICH_FIELD_FILLED')
        ctx.progress?.label(`Recomputing checksums… ${++filled}`)
    },
  })

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

// The project's declared overrides/resolutions, captured off the freshly-parsed
// graph (drops after any mutate — read it right after `parse`, thread into
// `patch`/`format`). Re-exported so the pipeline stays on this lib boundary.
export { overridesOf }
