import { ROUTES } from '../layout/constants'
import { LAYOUT, type FactoryLayout } from '../layout/factoryLayout'
import { simplify, type Vec2 } from './path'

/**
 * Handlers only move along corridor centrelines and short straight spurs into a pallet position.
 * Corridors are joined wherever they meet; every spur junction is a node, so a path is a list of
 * nodes on corridors and never cuts across storage.
 */

export type DwellKind = 'kanban' | 'pou' | 'stage' | 'park'

/** A place a handler stops to pick, drop or park: the load centre when the pallet is on the forks. */
export interface Dwell {
  id: string
  kind: DwellKind
  pos: Vec2
  junction: Vec2
  /** Unit vector from junction into the storage position (forks point this way when inside). */
  into: Vec2
  /** True if a handler left standing here would block a corridor or a neighbour's turn; it must not idle here. */
  blocksCorridor: boolean
}

export interface RouteGraph {
  nodes: Vec2[]
  adj: { to: number; w: number }[][]
  dwells: Map<string, Dwell>
}

const key = (p: Vec2) => `${p.x.toFixed(3)}:${p.z.toFixed(3)}`

export const kanbanDwellId = (slotId: string, index: number) => `kp:${slotId}:${index}`
export const pouDwellId = (station: string, pn: string) => `pou:${station}:${pn}`
export const stageDwellId = (i: number) => `stage:${i}`
export const parkDwellId = (i: number) => `park:${i}`

function unit(from: Vec2, to: Vec2): Vec2 {
  const l = Math.hypot(to.x - from.x, to.z - from.z) || 1
  return { x: (to.x - from.x) / l, z: (to.z - from.z) / l }
}

export function buildDwells(layout: FactoryLayout): Map<string, Dwell> {
  const dwells = new Map<string, Dwell>()
  const add = (id: string, kind: DwellKind, pos: Vec2, junction: Vec2, blocksCorridor: boolean) =>
    dwells.set(id, { id, kind, pos, junction, into: unit(junction, pos), blocksCorridor })

  for (const slot of layout.slots) {
    const aisle = layout.aisles.find((a) => a.id === slot.aisleId)!
    slot.pallets.forEach((p, i) => add(kanbanDwellId(slot.id, i), 'kanban', p, { x: p.x, z: aisle.z }, true))
  }
  for (const st of layout.stations) {
    for (const p of st.pou) add(pouDwellId(st.id, p.pn), 'pou', p, { x: st.serviceX, z: p.z }, true)
  }
  layout.stagingSlots.forEach((p, i) => add(stageDwellId(i), 'stage', p, { x: ROUTES.dsvAisleX, z: p.z }, false))
  layout.parkingSpots.forEach((p, i) => add(parkDwellId(i), 'park', p, p.junction, false))
  return dwells
}

function onSegment(p: Vec2, a: Vec2, b: Vec2): number | null {
  const dx = b.x - a.x, dz = b.z - a.z
  const L2 = dx * dx + dz * dz
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2
  if (t < -1e-6 || t > 1 + 1e-6) return null
  const d = Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z)
  return d < 1e-4 ? t : null
}

function intersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const d = (a2.x - a1.x) * (b2.z - b1.z) - (a2.z - a1.z) * (b2.x - b1.x)
  if (Math.abs(d) < 1e-9) return null
  const t = ((b1.x - a1.x) * (b2.z - b1.z) - (b1.z - a1.z) * (b2.x - b1.x)) / d
  const u = ((b1.x - a1.x) * (a2.z - a1.z) - (b1.z - a1.z) * (a2.x - a1.x)) / d
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null
  return { x: a1.x + (a2.x - a1.x) * t, z: a1.z + (a2.z - a1.z) * t }
}

export function buildGraph(layout: FactoryLayout): RouteGraph {
  const dwells = buildDwells(layout)
  const nodes: Vec2[] = []
  const index = new Map<string, number>()
  const nodeId = (p: Vec2) => {
    const k = key(p)
    let i = index.get(k)
    if (i === undefined) { i = nodes.length; nodes.push(p); index.set(k, i) }
    return i
  }
  const adj: { to: number; w: number }[][] = []
  const link = (i: number, j: number) => {
    const w = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z)
    if (w < 1e-6) return
    ;(adj[i] ??= []).push({ to: j, w })
    ;(adj[j] ??= []).push({ to: i, w })
  }

  const junctions = [...dwells.values()].map((d) => d.junction)
  for (const c of layout.corridors) {
    const pts: { t: number; p: Vec2 }[] = [{ t: 0, p: c.a }, { t: 1, p: c.b }]
    for (const o of layout.corridors) {
      if (o === c) continue
      const x = intersect(c.a, c.b, o.a, o.b)
      if (x) pts.push({ t: onSegment(x, c.a, c.b) ?? 0, p: x })
    }
    for (const j of junctions) {
      const t = onSegment(j, c.a, c.b)
      if (t !== null) pts.push({ t, p: j })
    }
    pts.sort((a, b) => a.t - b.t)
    const ids = pts.map((q) => nodeId(q.p))
    for (let i = 1; i < ids.length; i++) if (ids[i] !== ids[i - 1]) link(ids[i - 1], ids[i])
  }
  for (const d of dwells.values()) {
    if (!index.has(key(d.junction))) throw new Error(`Spur junction for ${d.id} is not on any corridor`)
  }
  for (let i = 0; i < nodes.length; i++) adj[i] ??= []
  return { nodes, adj, dwells }
}

/** Dijkstra between two corridor points (both must be graph nodes). */
export function shortestPath(g: RouteGraph, from: Vec2, to: Vec2): Vec2[] {
  const ids = new Map(g.nodes.map((n, i) => [key(n), i]))
  const s = ids.get(key(from)), t = ids.get(key(to))
  if (s === undefined || t === undefined) throw new Error('Route endpoint is not on the graph')
  const dist = new Array(g.nodes.length).fill(Infinity)
  const prev = new Array<number>(g.nodes.length).fill(-1)
  const done = new Array<boolean>(g.nodes.length).fill(false)
  dist[s] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
    if (u < 0 || u === t) break
    done[u] = true
    for (const e of g.adj[u]) {
      const nd = dist[u] + e.w
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u }
    }
  }
  if (dist[t] === Infinity) throw new Error('No route between points')
  const out: Vec2[] = []
  for (let u = t; u >= 0; u = prev[u]) out.unshift(g.nodes[u])
  return out
}

/**
 * Corridor polyline from one dwell to the junction of another: back out of the origin spur,
 * follow corridors, stop at the destination junction (where the handler turns to push in).
 */
export function routeBetween(g: RouteGraph, fromId: string, toId: string): Vec2[] {
  const a = g.dwells.get(fromId), b = g.dwells.get(toId)
  if (!a || !b) throw new Error(`Unknown dwell ${!a ? fromId : toId}`)
  return simplify([a.pos, ...shortestPath(g, a.junction, b.junction)])
}

export const GRAPH: RouteGraph = buildGraph(LAYOUT)
