import { distanceAt, pointAt, speedAt, type Path, type Profile, type Vec2 } from './path'

export type Phase = 'idle' | 'to-pick' | 'turning' | 'loading' | 'transporting' | 'unloading' | 'returning' | 'waiting'

export interface CarriedLoad { pn: string }

interface SegBase { t0: number; t1: number; phase: Phase; load: CarriedLoad | null; taskId: string | null }

/** Travel along a path. `forksFirst`: pushing into a spur, operator behind; otherwise the operator leads. */
export interface MoveSeg extends SegBase { kind: 'move'; path: Path; profile: Profile; forksFirst: boolean }
/** Standing still: turning on the spot, lifting/lowering forks, waiting or parked. */
export interface DwellSeg extends SegBase { kind: 'dwell'; pos: Vec2; yaw0: number; yaw1: number; lift0: number; lift1: number }
export type TimelineSeg = MoveSeg | DwellSeg

export interface Pose {
  x: number
  z: number
  /** Rotation about Y; the model's +Z (operator side) points along (sin yaw, cos yaw). */
  yaw: number
  /** Fork lift 0 (down) to 1 (raised). */
  lift: number
  speed: number
  load: CarriedLoad | null
  phase: Phase
  taskId: string | null
  /** Operator faces the forks (pushing in, loading, unloading) rather than the travel direction. */
  facingForks: boolean
}

export const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz)

const smooth = (u: number) => u * u * (3 - 2 * u)

export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return d
}

export function poseInSeg(seg: TimelineSeg, t: number): Pose {
  const base = { load: seg.load, phase: seg.phase, taskId: seg.taskId }
  if (seg.kind === 'dwell') {
    const span = seg.t1 - seg.t0
    const u = span > 0 ? smooth(Math.min(1, Math.max(0, (t - seg.t0) / span))) : 1
    const facingForks = seg.phase === 'loading' || seg.phase === 'unloading' || seg.phase === 'turning'
    return { ...base, x: seg.pos.x, z: seg.pos.z, yaw: seg.yaw0 + angleDelta(seg.yaw0, seg.yaw1) * u, lift: seg.lift0 + (seg.lift1 - seg.lift0) * u, speed: 0, facingForks }
  }
  const tl = Math.min(Math.max(t - seg.t0, 0), seg.profile.duration)
  const p = pointAt(seg.path, distanceAt(seg.profile, tl))
  const yaw = seg.forksFirst ? yawOf(-p.tx, -p.tz) : yawOf(p.tx, p.tz)
  return { ...base, x: p.x, z: p.z, yaw, lift: seg.load ? 1 : 0, speed: speedAt(seg.profile, tl), facingForks: seg.forksFirst }
}

/** Pose at any time. Before the first segment or after the last, the handler holds its pose. */
export function sampleSegs(segs: TimelineSeg[], t: number): Pose {
  if (t <= segs[0].t0) return poseInSeg(segs[0], segs[0].t0)
  const last = segs[segs.length - 1]
  if (t >= last.t1) {
    // After an unload completes the pallet belongs to the destination, not the forks.
    const p = poseInSeg(last, last.t1)
    return last.phase === 'unloading' ? { ...p, load: null, phase: 'idle', taskId: null, facingForks: false } : p
  }
  let lo = 0, hi = segs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segs[mid].t0 <= t) lo = mid
    else hi = mid - 1
  }
  return poseInSeg(segs[lo], t)
}

// ---- Footprint used for collision avoidance ----

/** Fork tip and operator positions along the model's Z axis, and the swept radius. */
const FORK_TIP = -0.6
const OPERATOR = 1.5
export const RADIUS_EMPTY = 0.45
export const RADIUS_LOADED = 0.55

export interface Capsule { a: Vec2; b: Vec2; r: number }

export function capsuleOf(p: Pose): Capsule {
  const sx = Math.sin(p.yaw), sz = Math.cos(p.yaw)
  return {
    a: { x: p.x + sx * FORK_TIP, z: p.z + sz * FORK_TIP },
    b: { x: p.x + sx * OPERATOR, z: p.z + sz * OPERATOR },
    r: p.load ? RADIUS_LOADED : RADIUS_EMPTY,
  }
}

function pointSegDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z
  const L2 = dx * dx + dz * dz
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2)) : 0
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z)
}

function segsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}

/** Clearance between two handler footprints (negative = overlapping). */
export function capsuleGap(p: Capsule, q: Capsule): number {
  const d = segsIntersect(p.a, p.b, q.a, q.b)
    ? 0
    : Math.min(pointSegDist(p.a, q.a, q.b), pointSegDist(p.b, q.a, q.b), pointSegDist(q.a, p.a, p.b), pointSegDist(q.b, p.a, p.b))
  return d - p.r - q.r
}
