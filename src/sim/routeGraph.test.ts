import { describe, expect, it } from 'vitest'
import { LAYOUT } from '../layout/factoryLayout'
import { OBSTACLES, distanceToRect } from './obstacles'
import { buildPath, pointAt } from './path'
import { GRAPH, routeBetween } from './routeGraph'
import type { Vec2 } from './path'
import { capsuleOf, RADIUS_EMPTY, RADIUS_LOADED, yawOf } from './timeline'

/** Lateral clearance a loaded handler needs: half a pallet's width plus a margin. */
const CORRIDOR_CLEARANCE = 0.55
const SPUR_CLEARANCE = 0.52
/** Radius swept when a handler turns on the spot at a junction (fork tip to operator). */
const TURN_RADIUS = 1.5

function samples(a: Vec2, b: Vec2, step = 0.2): Vec2[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step))
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n }))
}

function clearance(p: Vec2, exclude: Set<string> = new Set()) {
  let min = Infinity
  let what = ''
  for (const o of OBSTACLES) {
    if (exclude.has(o.id)) continue
    const d = distanceToRect(p, o.rect)
    if (d < min) { min = d; what = o.id }
  }
  return { min, what }
}

describe('route graph', () => {
  it('connects every dwell point to every other through corridors', () => {
    const park = '/park:0'.slice(1)
    for (const d of GRAPH.dwells.keys()) {
      expect(() => routeBetween(GRAPH, park, d), d).not.toThrow()
      expect(() => routeBetween(GRAPH, d, park), d).not.toThrow()
    }
  })

  it('keeps every corridor clear of storage, equipment, columns and walls', () => {
    for (const c of LAYOUT.corridors) {
      for (const p of samples(c.a, c.b)) {
        const { min, what } = clearance(p)
        expect(min, `${c.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) hits ${what}`).toBeGreaterThan(CORRIDOR_CLEARANCE)
      }
    }
  })

  it('keeps every spur clear of neighbouring pallets', () => {
    for (const d of GRAPH.dwells.values()) {
      for (const p of samples(d.junction, d.pos, 0.1)) {
        const { min, what } = clearance(p, new Set([d.id]))
        expect(min, `${d.id} spur hits ${what}`).toBeGreaterThan(SPUR_CLEARANCE)
      }
    }
  })

  it('leaves room to turn on the spot at every spur junction', () => {
    for (const d of GRAPH.dwells.values()) {
      const { min, what } = clearance(d.junction, new Set([d.id]))
      expect(min, `${d.id} turn hits ${what}`).toBeGreaterThan(TURN_RADIUS - 0.2)
    }
  })

  it('lets a handler idle at a safe spot without blocking any corridor', () => {
    for (const d of GRAPH.dwells.values()) {
      if (d.blocksCorridor) continue
      const cap = capsuleOf({ x: d.pos.x, z: d.pos.z, yaw: yawOf(-d.into.x, -d.into.z), lift: 0, speed: 0, load: null, phase: 'idle', taskId: null, facingForks: false })
      for (const c of LAYOUT.corridors) {
        for (const p of samples(c.a, c.b, 0.25)) {
          // Distance from a passing (loaded) handler's centreline to the parked one's footprint.
          const dx = cap.b.x - cap.a.x, dz = cap.b.z - cap.a.z
          const u = Math.max(0, Math.min(1, ((p.x - cap.a.x) * dx + (p.z - cap.a.z) * dz) / (dx * dx + dz * dz)))
          const gap = Math.hypot(cap.a.x + dx * u - p.x, cap.a.z + dz * u - p.z) - RADIUS_EMPTY - RADIUS_LOADED
          expect(gap, `${d.id} blocks ${c.id}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('produces smooth paths whose points stay on the corridor network', () => {
    const route = routeBetween(GRAPH, 'park:0', [...GRAPH.dwells.keys()].find((k) => k.startsWith('kp:1225629#0'))!)
    const path = buildPath(route, 1)
    let prev = pointAt(path, 0)
    for (let s = 0.1; s <= path.length; s += 0.1) {
      const q = pointAt(path, s)
      expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(0.1001)
      // Heading changes gradually: no instant turns.
      expect(Math.acos(Math.min(1, q.tx * prev.tx + q.tz * prev.tz))).toBeLessThan(0.15)
      prev = q
    }
  })
})
