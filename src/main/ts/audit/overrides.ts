import type { OverrideConstraint, PmConfigEvidence } from 'lockgraph'

import type { ecosystemFor } from './adapter'

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
export const toPolicy = (
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
