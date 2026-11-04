import { describe, expect, it } from 'vitest'
import { LAYOUT } from '../layout/factoryLayout'
import { isFree, WALK_SPAWN, WALKER_RADIUS, walkMove } from './walk'

/** Flood fill over a 0.25 m grid of free walker positions, from the spawn point. */
function reachable() {
  const step = 0.25
  const b = LAYOUT.building
  const key = (i: number, j: number) => i * 10000 + j
  const at = (i: number, j: number) => ({ x: b.minX + i * step, z: b.minZ + j * step })
  const start = [Math.round((WALK_SPAWN.x - b.minX) / step), Math.round((WALK_SPAWN.z - b.minZ) / step)]
  const seen = new Set([key(start[0], start[1])])
  const queue = [start]
  while (queue.length) {
    const [i, j] = queue.pop()!
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, k = key(ni, nj)
      if (seen.has(k) || !isFree(at(ni, nj))) continue
      seen.add(k)
      queue.push([ni, nj])
    }
  }
  return (p: { x: number; z: number }) => seen.has(key(Math.round((p.x - b.minX) / step), Math.round((p.z - b.minZ) / step)))
}

describe('first-person walkthrough', () => {
  it('starts on free floor', () => {
    expect(isFree(WALK_SPAWN)).toBe(true)
  })

  it('cannot walk through walls, the conveyor, benches or storage', () => {
    const st = LAYOUT.stations.find((s) => s.id === 'WS3')!
    // Walk straight at the conveyor from the POU side: stopped at the bed edge.
    const from = { x: st.rack.x - 1.2, z: st.rack.z + 4 }
    expect(isFree(from)).toBe(true)
    const to = walkMove(from, 3, 0)
    const bed = LAYOUT.conveyor.rects[0]
    expect(to.x).toBeLessThanOrEqual(bed.minX - WALKER_RADIUS + 1e-9)
    // A big step (fast frame) must not tunnel through a bench.
    const nearBench = { x: st.bench.x - 0.8, z: st.bench.z + 1.6 }
    expect(walkMove(nearBench, 0, -3).z).toBeGreaterThan(st.bench.z)
    // Into the east wall.
    expect(walkMove({ x: LAYOUT.building.maxX - 1, z: 30 }, 5, 0).x).toBeLessThanOrEqual(LAYOUT.building.maxX - WALKER_RADIUS)
    // Slides along an obstacle instead of sticking: diagonal into the bed still moves along it.
    const slid = walkMove(from, 3, 1)
    expect(slid.z).toBeGreaterThan(from.z + 0.9)
  })

  it('can reach both sides of every workstation, the Kanban area and the DSV warehouse', () => {
    const can = reachable()
    for (const s of LAYOUT.stations.filter((x) => x.id !== 'SUBASSY')) {
      const sideA = { x: s.rack.x - 2.1, z: s.rack.z + 1.2 }   // POU side, behind worker A
      const sideB = { x: s.bench.x + 0.95, z: s.rack.z }         // between bench and outfeed
      expect(can(sideA), `${s.id} POU side`).toBe(true)
      expect(can(sideB), `${s.id} bench side`).toBe(true)
    }
    expect(can({ x: 26.5, z: 20 }), 'CLS pick aisle').toBe(true)
    expect(can({ x: -1.75, z: 20 }), 'DSV aisle').toBe(true)
    expect(can({ x: 58, z: 30 }), 'main aisle').toBe(true)
  }, 60000)
})
