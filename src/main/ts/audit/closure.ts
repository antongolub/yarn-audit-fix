import sv from 'semver'

import type { Graph } from 'lockgraph'

import {
  ALL_FIELDS,
  PROD_FIELDS,
  namesIn,
  norm,
  normalizeRange,
} from './scope-util'
import type { GNode, NodeId } from './scope-util'

/**
 * Edges to follow out of a node: all of them for a regular package, but only the
 * production ones for a workspace reached transitively — one workspace's dev tree is
 * not part of another's closure.
 */
const outEdges = (
  graph: Graph,
  node: GNode,
  prodNamesByDir: Map<string, Set<string>>,
) => {
  const edges = graph.out(node.id)
  if (node.workspacePath === undefined) return edges
  const prod = prodNamesByDir.get(norm(node.workspacePath))
  if (!prod) return edges
  return edges.filter((e) => {
    const dst = graph.getNode(e.target)
    return dst ? prod.has(dst.name) : false
  })
}

/** Graph nodes for a declared dep whose version satisfies its range. */
const nodesMatching = (
  graph: Graph,
  name: string,
  range: unknown,
): NodeId[] => {
  const r = normalizeRange(range)
  return graph.byName(name).filter((id) => {
    const node = graph.getNode(id)
    return (
      !!node &&
      (!r || (sv.valid(node.version) && sv.satisfies(node.version, r)))
    )
  })
}

/**
 * yarn classic has no workspace node to read out-edges from, so resolve each declared
 * dep by name and keep every graph node whose version satisfies the declared range.
 */
export const seedByNameAndRange = (
  graph: Graph,
  manifest: Record<string, any> | undefined,
  production: boolean,
  seeds: Set<NodeId>,
): void => {
  for (const field of production ? PROD_FIELDS : ALL_FIELDS) {
    const deps = manifest?.[field]
    if (!deps || typeof deps !== 'object') continue
    for (const [name, range] of Object.entries(deps))
      for (const id of nodesMatching(graph, name, range)) seeds.add(id)
  }
}

/**
 * The scope roots: each selected workspace's direct deps resolved to node ids. Uses
 * the workspace node's own out-edges where the lockfile has one; falls back to
 * resolving declared deps by name + range on yarn classic, which has none.
 */
export const seedRoots = (
  graph: Graph,
  selected: string[],
  manifestByDir: Map<string, Record<string, any>>,
  wsNodeByDir: Map<string, GNode>,
  production: boolean,
): Set<NodeId> => {
  // Seed: each selected workspace's direct deps → their resolved nodes.
  const seeds = new Set<NodeId>()
  for (const dir of selected) {
    const manifest = manifestByDir.get(dir)
    const seedNames = namesIn(manifest, production ? PROD_FIELDS : ALL_FIELDS)
    if (seedNames.size === 0) continue
    const wsNode = wsNodeByDir.get(dir)
    if (wsNode) {
      // Precise: this workspace's own out-edges (exact resolved versions).
      for (const e of graph.out(wsNode.id)) {
        const dst = graph.getNode(e.target)
        if (dst && seedNames.has(dst.name)) seeds.add(e.target)
      }
    } else {
      seedByNameAndRange(graph, manifest, production, seeds)
    }
  }
  return seeds
}

/**
 * Walk out from the roots: every edge of a regular node, but only production edges
 * of a workspace reached transitively — one workspace's dev tree is not part of
 * another's closure.
 */
export const walkClosure = (
  graph: Graph,
  seeds: Set<NodeId>,
  prodNamesByDir: Map<string, Set<string>>,
): Set<NodeId> => {
  // Walk out: all edges from a regular node; only production edges from a workspace
  // reached transitively (its dev tree isn't part of the depending closure).
  const inScope = new Set<NodeId>(seeds)
  const queue = [...seeds]
  while (queue.length > 0) {
    const id = queue.pop() as NodeId
    const node = graph.getNode(id)
    if (!node) continue
    for (const e of outEdges(graph, node, prodNamesByDir))
      if (!inScope.has(e.target)) {
        inScope.add(e.target)
        queue.push(e.target)
      }
  }
  return inScope
}
