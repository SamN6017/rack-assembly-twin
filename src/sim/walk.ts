import { WORKER } from '../layout/constants'
import { LAYOUT, type Rect } from '../layout/factoryLayout'
import { OBSTACLES } from './obstacles'
import type { Vec2 } from './path'

/**
 * Collision for the first-person walkthrough: the walker is a circle on the floor that slides along
 * anything solid. Static only: walls, racking, pallets, benches, the rack conveyor, workers. Moving
 * handlers are not obstacles (the walker can pass through them).
 */

export const WALKER_RADIUS = 0.3
export const EYE_HEIGHT = 1.7
/** Where the walkthrough starts: the head of the assembly line, looking down it. */
export const WALK_SPAWN: Vec2 & { yaw: number } = { x: 48.4, z: 2.0, yaw: Math.PI }

const CELL = 2
const solids: Rect[] = [
  ...OBSTACLES.map((o) => o.rect),
  ...LAYOUT.workers.map((w) => ({ minX: w.x - WORKER.radius, maxX: w.x + WORKER.radius, minZ: w.z - WORKER.radius, maxZ: w.z + WORKER.radius })),
]
const grid = new Map<string, Rect[]>()
for (const r of solids) {
  for (let i = Math.floor(r.minX / CELL) - 1; i <= Math.floor(r.maxX / CELL) + 1; i++)
    for (let j = Math.floor(r.minZ / CELL) - 1; j <= Math.floor(r.maxZ / CELL) + 1; j++) {
      const k = `${i},${j}`
      const list = grid.get(k) ?? []
      list.push(r)
      grid.set(k, list)
    }
}

const nearby = (p: Vec2) => grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`) ?? []

const distTo = (p: Vec2, r: Rect) => Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ))

/** True when a walker standing at p touches nothing solid. */
export function isFree(p: Vec2, radius = WALKER_RADIUS): boolean {
  const b = LAYOUT.building
  if (p.x - radius < b.minX || p.x + radius > b.maxX || p.z - radius < b.minZ || p.z + radius > b.maxZ) return false
  return nearby(p).every((r) => distTo(p, r) >= radius)
}

/**
 * Move from `p` by (dx, dz), sliding along obstacles: try the full step, then each axis alone.
 * Long steps are split so a fast frame can never tunnel through a thin obstacle.
 */
export function walkMove(p: Vec2, dx: number, dz: number, radius = WALKER_RADIUS): Vec2 {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius * 0.5)))
  let cur = { ...p }
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps, sz = dz / steps
    const both = { x: cur.x + sx, z: cur.z + sz }
    if (isFree(both, radius)) { cur = both; continue }
    const onlyX = { x: cur.x + sx, z: cur.z }
    if (sx && isFree(onlyX, radius)) { cur = onlyX; continue }
    const onlyZ = { x: cur.x, z: cur.z + sz }
    if (sz && isFree(onlyZ, radius)) cur = onlyZ
  }
  return cur
}

/** Walking speed presets, m/s. Sprint (Shift) is twice the walk. Tuned to the ~110 x 80 m hall. */
export const WALK_SPEEDS = { slow: 2.0, normal: 3.5, fast: 5.0 } as const
export type WalkSpeed = keyof typeof WALK_SPEEDS
export const SPRINT_FACTOR = 2

/** How quickly velocity follows the keys (1/s): ~0.15 s to reach full speed or stop. */
const RESPONSE = 14

export interface WalkInput { forward: number; right: number; sprint: boolean }
export interface Walker { x: number; z: number; yaw: number; vx: number; vz: number }

/**
 * Advance the walker by dt seconds of real time. Input is normalised, so diagonal movement is no
 * faster than straight; velocity eases toward the target with an exponential response, so the
 * same keys cover the same ground at any frame rate. Collision slides along obstacles.
 */
export function stepWalker(w: Walker, input: WalkInput, dt: number, speed: WalkSpeed = 'normal'): Walker {
  const v = WALK_SPEEDS[speed] * (input.sprint ? SPRINT_FACTOR : 1)
  // Camera looks down -Z at yaw 0: forward is (-sin, -cos), right is (cos, -sin).
  const sin = Math.sin(w.yaw), cos = Math.cos(w.yaw)
  let tx = -sin * input.forward + cos * input.right
  let tz = -cos * input.forward - sin * input.right
  const n = Math.hypot(tx, tz)
  if (n > 0) { tx = (tx / n) * v; tz = (tz / n) * v }
  const a = 1 - Math.exp(-RESPONSE * dt)
  let vx = w.vx + (tx - w.vx) * a
  let vz = w.vz + (tz - w.vz) * a
  if (Math.hypot(vx, vz) < 0.02) return { ...w, vx: 0, vz: 0 }
  const next = walkMove(w, vx * dt, vz * dt)
  // Lose the velocity that ran into a wall, so the walker doesn't keep pressing against it.
  if (dt > 0) { vx = (next.x - w.x) / dt; vz = (next.z - w.z) / dt }
  return { ...w, x: next.x, z: next.z, vx, vz }
}
