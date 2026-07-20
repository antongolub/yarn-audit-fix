import fs from 'node:fs'
import path from 'node:path'

import { detect, parse } from 'lockgraph'
import type { Graph } from 'lockgraph'
import { describe, expect, it } from 'vitest'

import { describeScope, resolveScope } from '../../main/ts/audit/scope'
import { getWorkspaces } from '../../main/ts/util'

// A minimal in-memory graph exposing just the four methods resolveScope uses
// (nodes / getNode / out / byName) — lets each scenario assert the reachability
// BFS precisely, without hand-crafting a berry lockfile.
type N = { id: string; name: string; version: string; workspacePath?: string }
type E = { src: string; dst: string }
const graphOf = (nodes: N[], edges: E[]): Graph =>
  ({
    nodes: () => nodes.values(),
    getNode: (id: string) => nodes.find((n) => n.id === id),
    out: (id: string) => edges.filter((e) => e.src === id),
    byName: (name: string) => nodes.filter((n) => n.name === name).map((n) => n.id),
  }) as unknown as Graph

const CWD = '/repo'
const mf = (dir: string, manifest: Record<string, any>) => ({
  file: path.join(CWD, dir, 'package.json'),
  manifest,
})

describe('resolveScope', () => {
  it('no scope flag → undefined (no filtering, unchanged output)', () => {
    const g = graphOf([{ id: 'a@1', name: 'a', version: '1.0.0' }], [])
    expect(resolveScope({}, g, [mf('', { name: 'root' })], CWD)).toBeUndefined()
  })

  it('a stringy falsy env value (YAF_PRODUCTION=false) does not enable scope', () => {
    const g = graphOf([{ id: 'a@1', name: 'a', version: '1.0.0' }], [])
    expect(
      resolveScope({ production: 'false' }, g, [mf('', { name: 'root' })], CWD),
    ).toBeUndefined()
    expect(
      resolveScope({ production: '0' }, g, [mf('', { name: 'root' })], CWD),
    ).toBeUndefined()
  })

  it('--production keeps the prod closure and drops dev-only deps', () => {
    const nodes: N[] = [
      { id: 'root@ws', name: 'root', version: '0.0.0', workspacePath: '' },
      { id: 'prod@1', name: 'prod', version: '1.0.0' },
      { id: 'dev@1', name: 'dev', version: '1.0.0' },
      { id: 'shared@1', name: 'shared', version: '1.0.0' }, // pulled in by prod
      { id: 'devonly@1', name: 'devonly', version: '1.0.0' }, // pulled in by dev
    ]
    const edges: E[] = [
      { src: 'root@ws', dst: 'prod@1' },
      { src: 'root@ws', dst: 'dev@1' },
      { src: 'prod@1', dst: 'shared@1' },
      { src: 'dev@1', dst: 'devonly@1' },
    ]
    const files = [
      mf('', {
        name: 'root',
        dependencies: { prod: '^1.0.0' },
        devDependencies: { dev: '^1.0.0' },
      }),
    ]
    const scope = resolveScope({ production: true }, graphOf(nodes, edges), files, CWD)!
    expect([...scope].sort()).toEqual(['prod@1', 'shared@1'])
    expect(scope.has('dev@1')).toBe(false)
    expect(scope.has('devonly@1')).toBe(false)
  })

  it('--workspace alone (no --production) still includes the selected workspace dev deps', () => {
    const nodes: N[] = [
      { id: 'root@ws', name: 'root', version: '0.0.0', workspacePath: '' },
      { id: 'prod@1', name: 'prod', version: '1.0.0' },
      { id: 'dev@1', name: 'dev', version: '1.0.0' },
    ]
    const edges: E[] = [
      { src: 'root@ws', dst: 'prod@1' },
      { src: 'root@ws', dst: 'dev@1' },
    ]
    const files = [
      mf('', {
        name: 'root',
        dependencies: { prod: '^1.0.0' },
        devDependencies: { dev: '^1.0.0' },
      }),
    ]
    const scope = resolveScope({ workspace: 'root' }, graphOf(nodes, edges), files, CWD)!
    expect(scope.has('prod@1')).toBe(true)
    expect(scope.has('dev@1')).toBe(true) // dev included — you selected this workspace
  })

  it('--workspace selects only the named workspace closure', () => {
    const nodes: N[] = [
      { id: 'a@ws', name: 'a', version: '0.0.0', workspacePath: 'packages/a' },
      { id: 'b@ws', name: 'b', version: '0.0.0', workspacePath: 'packages/b' },
      { id: 'depa@1', name: 'depa', version: '1.0.0' },
      { id: 'depb@1', name: 'depb', version: '1.0.0' },
    ]
    const edges: E[] = [
      { src: 'a@ws', dst: 'depa@1' },
      { src: 'b@ws', dst: 'depb@1' },
    ]
    const files = [
      mf('', { name: 'root' }),
      mf('packages/a', { name: 'a', dependencies: { depa: '^1.0.0' } }),
      mf('packages/b', { name: 'b', dependencies: { depb: '^1.0.0' } }),
    ]
    const g = graphOf(nodes, edges)
    // by name
    expect(resolveScope({ workspace: 'a' }, g, files, CWD)!.has('depa@1')).toBe(true)
    expect(resolveScope({ workspace: 'a' }, g, files, CWD)!.has('depb@1')).toBe(false)
    // by path glob
    const glob = resolveScope({ workspace: 'packages/b' }, g, files, CWD)!
    expect(glob.has('depb@1')).toBe(true)
    expect(glob.has('depa@1')).toBe(false)
  })

  it('a workspace reached as a dependency contributes only its prod edges', () => {
    // a → b (workspace:); b has a prod dep and a dev dep. Selecting a must not
    // pull b's dev tree into a's closure, even without --production.
    const nodes: N[] = [
      { id: 'a@ws', name: 'a', version: '0.0.0', workspacePath: 'packages/a' },
      { id: 'b@ws', name: 'b', version: '0.0.0', workspacePath: 'packages/b' },
      { id: 'bprod@1', name: 'bprod', version: '1.0.0' },
      { id: 'bdev@1', name: 'bdev', version: '1.0.0' },
    ]
    const edges: E[] = [
      { src: 'a@ws', dst: 'b@ws' },
      { src: 'b@ws', dst: 'bprod@1' },
      { src: 'b@ws', dst: 'bdev@1' },
    ]
    const files = [
      mf('packages/a', { name: 'a', dependencies: { b: 'workspace:*' } }),
      mf('packages/b', {
        name: 'b',
        dependencies: { bprod: '^1.0.0' },
        devDependencies: { bdev: '^1.0.0' },
      }),
    ]
    const scope = resolveScope({ workspace: 'a' }, graphOf(nodes, edges), files, CWD)!
    expect(scope.has('bprod@1')).toBe(true)
    expect(scope.has('bdev@1')).toBe(false) // b's dev tree stays out of a's closure
  })

  it('yarn v1 (no workspace node): seeds prod deps by name + range', () => {
    const nodes: N[] = [
      { id: 'prod@1.5.0', name: 'prod', version: '1.5.0' },
      { id: 'prod@2.0.0', name: 'prod', version: '2.0.0' }, // out of the declared range
      { id: 'shared@1', name: 'shared', version: '1.0.0' },
      { id: 'devonly@1', name: 'devonly', version: '1.0.0' },
    ]
    const edges: E[] = [{ src: 'prod@1.5.0', dst: 'shared@1' }]
    const files = [
      mf('', {
        name: 'root',
        dependencies: { prod: '^1.0.0' },
        devDependencies: { devonly: '^1.0.0' },
      }),
    ]
    const scope = resolveScope({ production: true }, graphOf(nodes, edges), files, CWD)!
    expect(scope.has('prod@1.5.0')).toBe(true)
    expect(scope.has('shared@1')).toBe(true)
    expect(scope.has('prod@2.0.0')).toBe(false) // range gate excludes the 2.x line
    expect(scope.has('devonly@1')).toBe(false)
  })

  it('--workspace matching nothing throws (a typo should not silently fix nothing)', () => {
    const g = graphOf([], [])
    expect(() =>
      resolveScope({ workspace: 'nope' }, g, [mf('', { name: 'root' })], CWD),
    ).toThrow(/matched no workspaces/)
  })
})

describe('describeScope', () => {
  it('names the active axes', () => {
    expect(describeScope({ production: true })).toBe('production')
    expect(describeScope({ workspace: 'core' })).toBe('workspaces [core]')
    expect(describeScope({ production: true, workspace: 'a,b' })).toBe(
      'production + workspaces [a, b]',
    )
  })
})

describe('resolveScope on a real monorepo lockfile (sequelize)', () => {
  const dir = 'src/test/fixtures/real-world/sequelize-sequelize-main-8260c29'
  const hasFixture = fs.existsSync(path.join(dir, 'yarn.lock'))
  const load = () => {
    const text = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf8')
    const graph = parse(detect(text), text, { workspaceRoot: dir })
    const root = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const files = [
      { file: path.join(dir, 'package.json'), manifest: root },
      ...getWorkspaces(dir, root).map((f) => ({
        file: f,
        manifest: JSON.parse(fs.readFileSync(f, 'utf8')),
      })),
    ]
    return { graph, files }
  }

  it.runIf(hasFixture)('--production is a non-empty strict subset of the graph', () => {
    const { graph, files } = load()
    const total = [...graph.nodes()].length
    const prod = resolveScope({ production: true }, graph, files, dir)!
    expect(prod.size).toBeGreaterThan(0)
    expect(prod.size).toBeLessThan(total) // dev-only packages are excluded
  })

  it.runIf(hasFixture)('--workspace=@sequelize/core scopes to that package', () => {
    const { graph, files } = load()
    const core = resolveScope({ workspace: '@sequelize/core' }, graph, files, dir)!
    expect(core.size).toBeGreaterThan(0)
    expect(core.size).toBeLessThan([...graph.nodes()].length)
  })
})
