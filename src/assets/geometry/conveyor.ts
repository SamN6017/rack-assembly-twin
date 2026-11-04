import type { Conveyor, Rect } from '../../layout/factoryLayout'
import { GeoBuilder } from './builder'

const ROLLER_PITCH = 0.2
const ROLLER_R = 0.03
const LEG_PITCH = 1.6
const RAIL = 0.06

/**
 * Powered roller conveyor for rack carriers, one bed per footprint rectangle: side channels at deck
 * height, rollers across the bed, legs with feet, low guide rails. Where beds meet, the overlap
 * stands in for a 90° transfer table (racks keep their orientation round corners). Illustrative:
 * no line equipment drawings were supplied.
 */
export function buildConveyor(c: Conveyor): GeoBuilder {
  const b = new GeoBuilder()
  const top = c.bedHeight
  for (const r of c.rects) bed(b, r, top)
  return b
}

function bed(b: GeoBuilder, r: Rect, top: number) {
  const alongX = r.maxX - r.minX > r.maxZ - r.minZ
  const len = alongX ? r.maxX - r.minX : r.maxZ - r.minZ
  const wid = alongX ? r.maxZ - r.minZ : r.maxX - r.minX
  const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2
  // Local (u along travel, v across) to world.
  const at = (u: number, v: number) => (alongX ? { x: r.minX + u, z: cz + v } : { x: cx + v, z: r.minZ + u })
  const box = (mat: Parameters<GeoBuilder['box']>[0], du: number, h: number, dv: number, u: number, y: number, v: number) => {
    const p = at(u, v)
    return alongX ? b.box(mat, du, h, dv, p.x, y, p.z) : b.box(mat, dv, h, du, p.x, y, p.z)
  }
  for (const s of [-1, 1]) {
    const v = s * (wid / 2 - RAIL / 2)
    box('conveyorBlue', len, 0.12, RAIL, len / 2, top - 0.06, v)                      // side channel
    box('safetyYellow', len, 0.035, 0.03, len / 2, top + 0.06, s * (wid / 2 - 0.03))  // guide rail
    for (let u = 0.3; u < len - 0.1; u += LEG_PITCH) {
      box('conveyorBlue', 0.06, top - 0.12, 0.06, u, (top - 0.12) / 2, v)
      box('steelGrey', 0.14, 0.012, 0.14, u, 0.006, v)
    }
  }
  for (let u = 0.3; u < len - 0.1; u += LEG_PITCH) box('conveyorBlue', 0.05, 0.04, wid - 2 * RAIL, u, 0.08, 0)
  for (let u = ROLLER_PITCH / 2; u < len; u += ROLLER_PITCH) {
    const p = at(u, 0)
    b.cyl('zinc', ROLLER_R, wid - 2 * RAIL, p.x, top - ROLLER_R, p.z, alongX ? 'z' : 'x', 10)
  }
}

/** Safety yellow floor tape: a strip of width w along a polyline (y just above the floor). */
export function floorTape(b: GeoBuilder, pts: { x: number; z: number }[], w = 0.08, mat: 'floorYellow' | 'floorWhite' = 'floorYellow', dash = 0) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], c = pts[i]
    const dx = c.x - a.x, dz = c.z - a.z
    const L = Math.hypot(dx, dz)
    const yaw = Math.atan2(dx, dz)
    if (!dash) { b.box(mat, w, 0.004, L, (a.x + c.x) / 2, 0.003, (a.z + c.z) / 2, yaw); continue }
    for (let s = 0; s < L; s += dash * 2) {
      const e = Math.min(L, s + dash)
      const m = (s + e) / 2 / L
      b.box(mat, w, 0.004, e - s, a.x + dx * m, 0.003, a.z + dz * m, yaw)
    }
  }
}

/** Waist-high guard rail with posts, between moving equipment and a walkway. */
export function guardRail(b: GeoBuilder, a: { x: number; z: number }, c: { x: number; z: number }) {
  const dx = c.x - a.x, dz = c.z - a.z
  const L = Math.hypot(dx, dz)
  const yaw = Math.atan2(dx, dz)
  const n = Math.max(1, Math.round(L / 2))
  for (let i = 0; i <= n; i++) {
    const f = i / n
    b.box('safetyYellow', 0.08, 1.05, 0.08, a.x + dx * f, 0.525, a.z + dz * f)
    b.box('steelGrey', 0.2, 0.012, 0.2, a.x + dx * f, 0.006, a.z + dz * f)
  }
  for (const y of [0.55, 1.0]) b.box('safetyYellow', 0.05, 0.05, L, (a.x + c.x) / 2, y, (a.z + c.z) / 2, yaw)
}
