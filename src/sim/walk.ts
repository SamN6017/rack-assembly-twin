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
