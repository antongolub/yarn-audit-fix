import path from 'node:path'

import { getWorkspaces, readJson, attempt } from '../util'

/** A manifest file whose direct-dep ranges the gate consults, paired with its
 *  parsed content. `file` is where a --force rewrite lands. */
export type TManifestFile = { file: string; manifest: Record<string, any> }

/**
 * The manifest files the gate consults: the root package.json + every workspace
 * package.json (monorepo, discovered from the root `workspaces` globs). The root
 * reuses the already-parsed `ctx.manifest`; each workspace is read best-effort (an
 * unreadable one is skipped). Absent cwd (direct/test calls) → the root alone.
 */
export const collectManifestFiles = (
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
export const manifestDirectRanges = (
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
