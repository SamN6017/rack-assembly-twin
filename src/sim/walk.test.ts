import { describe, expect, it } from 'vitest'
import { LAYOUT } from '../layout/factoryLayout'
import { isFree, SPRINT_FACTOR, stepWalker, WALK_SPAWN, WALK_SPEEDS, WALKER_RADIUS, walkMove, type WalkInput } from './walk'

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

  /** Walk for `seconds` at `fps` from a clear spot on the main aisle, heading down it (+Z). */
  const walk = (input: WalkInput, seconds: number, fps: number, speed: keyof typeof WALK_SPEEDS = 'normal') => {
    let w = { x: 58, z: 8, yaw: Math.PI, vx: 0, vz: 0 }
    for (let i = 0; i < Math.round(seconds * fps); i++) w = stepWalker(w, input, 1 / fps, speed)
    return Math.hypot(w.x - 58, w.z - 8)
  }

  it('walks at the preset speed, sprints at twice that, whatever the frame rate', () => {
    const fwd = { forward: 1, right: 0, sprint: false }
    // 2 s from standing: the ~0.15 s ramp costs a little under one step of distance.
    const normal = walk(fwd, 2, 60)
    expect(normal).toBeGreaterThan(WALK_SPEEDS.normal * 2 - 0.4)
    expect(normal).toBeLessThanOrEqual(WALK_SPEEDS.normal * 2 + 1e-9)
    const sprint = walk({ ...fwd, sprint: true }, 2, 60)
    expect(sprint / normal).toBeGreaterThan(SPRINT_FACTOR * 0.95)
    expect(walk(fwd, 2, 60, 'slow')).toBeLessThan(normal)
    expect(walk(fwd, 2, 60, 'fast')).toBeGreaterThan(normal)
    // Same ground covered at 144, 60 and 15 fps.
    for (const fps of [144, 15]) expect(Math.abs(walk(fwd, 2, fps) - normal) / normal).toBeLessThan(0.03)
  })

  it('is no faster diagonally than straight ahead', () => {
    const straight = walk({ forward: 1, right: 0, sprint: false }, 1.5, 60)
    const diagonal = walk({ forward: 1, right: 1, sprint: false }, 1.5, 60)
    expect(diagonal).toBeLessThanOrEqual(straight + 1e-6)
  })

  it('stops smoothly when the keys are released', () => {
    let w = { x: 58, z: 8, yaw: Math.PI, vx: 0, vz: 0 }
    for (let i = 0; i < 60; i++) w = stepWalker(w, { forward: 1, right: 0, sprint: false }, 1 / 60)
    for (let i = 0; i < 30; i++) w = stepWalker(w, { forward: 0, right: 0, sprint: false }, 1 / 60)
    expect(Math.hypot(w.vx, w.vz)).toBe(0)
  })
})
