/**
 * Smooth travel paths and speed profiles. Pure functions: a handler's pose is computed from the
 * simulation time alone, so animation can never drift from the clock, and pause, speed change and
 * reset need no special handling.
 */

export interface Vec2 { x: number; z: number }

type LineSeg = { kind: 'line'; a: Vec2; b: Vec2; len: number }
type ArcSeg = { kind: 'arc'; c: Vec2; r: number; a0: number; sweep: number; len: number }
export type Seg = LineSeg | ArcSeg

export interface Path { segs: Seg[]; length: number; start: Vec2; end: Vec2 }
export interface PathPoint { x: number; z: number; tx: number; tz: number }

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z })
const len = (v: Vec2) => Math.hypot(v.x, v.z)
const norm = (v: Vec2): Vec2 => { const l = len(v) || 1; return { x: v.x / l, z: v.z / l } }

/** Drop repeated and collinear interior points. */
export function simplify(points: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1e-6) continue
    if (out.length >= 2) {
      const a = out[out.length - 2]
      const cross = (last.x - a.x) * (p.z - last.z) - (last.z - a.z) * (p.x - last.x)
      const dot = (last.x - a.x) * (p.x - last.x) + (last.z - a.z) * (p.z - last.z)
      if (Math.abs(cross) < 1e-6 && dot > 0) { out[out.length - 1] = p; continue }
    }
    out.push(p)
  }
  return out
}

/**
 * Polyline with each corner replaced by a circular fillet of radius up to `radius`, so heading
 * changes continuously through turns. Fillets never use more than half of a shared segment.
 */
export function buildPath(points: Vec2[], radius = 1.0): Path {
  const pts = simplify(points)
  if (pts.length < 2) {
    const p = pts[0] ?? { x: 0, z: 0 }
    return { segs: [], length: 0, start: p, end: p }
  }
  const segs: Seg[] = []
  let cursor = pts[0]
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1]
    const d1 = norm(sub(p0, p1)), d2 = norm(sub(p2, p1))
    const theta = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.z * d2.z)))
    const share1 = i - 1 === 0 ? 0.9 : 0.5
    const share2 = i + 1 === pts.length - 1 ? 0.9 : 0.5
    let t = radius / Math.tan(theta / 2)
    t = Math.min(t, len(sub(p0, p1)) * share1, len(sub(p2, p1)) * share2)
    const r = t * Math.tan(theta / 2)
    const t1 = { x: p1.x + d1.x * t, z: p1.z + d1.z * t }
    const t2 = { x: p1.x + d2.x * t, z: p1.z + d2.z * t }
    const bis = norm({ x: d1.x + d2.x, z: d1.z + d2.z })
    const c = { x: p1.x + bis.x * (r / Math.sin(theta / 2)), z: p1.z + bis.z * (r / Math.sin(theta / 2)) }
    const dirIn = { x: -d1.x, z: -d1.z }
    const sign = Math.sign(dirIn.x * d2.z - dirIn.z * d2.x) || 1
    const sweep = sign * (Math.PI - theta)
    const lineLen = len(sub(t1, cursor))
    if (lineLen > 1e-9) segs.push({ kind: 'line', a: cursor, b: t1, len: lineLen })
    segs.push({ kind: 'arc', c, r, a0: Math.atan2(t1.z - c.z, t1.x - c.x), sweep, len: Math.abs(sweep) * r })
    cursor = t2
  }
  const last = pts[pts.length - 1]
  const tail = len(sub(last, cursor))
  if (tail > 1e-9) segs.push({ kind: 'line', a: cursor, b: last, len: tail })
  return { segs, length: segs.reduce((s, g) => s + g.len, 0), start: pts[0], end: last }
}

/** Position and unit tangent at arc length `s` (clamped to the path). */
export function pointAt(path: Path, s: number): PathPoint {
  if (!path.segs.length) return { x: path.start.x, z: path.start.z, tx: 0, tz: 1 }
  let rest = Math.max(0, Math.min(s, path.length))
  for (let i = 0; i < path.segs.length; i++) {
    const g = path.segs[i]
    if (rest > g.len && i < path.segs.length - 1) { rest -= g.len; continue }
    const u = g.len > 0 ? Math.min(rest / g.len, 1) : 0
    if (g.kind === 'line') {
      const tx = (g.b.x - g.a.x) / g.len, tz = (g.b.z - g.a.z) / g.len
      return { x: g.a.x + (g.b.x - g.a.x) * u, z: g.a.z + (g.b.z - g.a.z) * u, tx, tz }
    }
    const a = g.a0 + g.sweep * u
    const sgn = Math.sign(g.sweep)
    return { x: g.c.x + g.r * Math.cos(a), z: g.c.z + g.r * Math.sin(a), tx: -Math.sin(a) * sgn, tz: Math.cos(a) * sgn }
  }
  return { x: path.end.x, z: path.end.z, tx: 0, tz: 1 }
}

/** Trapezoidal (or triangular) speed profile: accelerate, cruise, decelerate to a stop. */
export interface Profile { length: number; vmax: number; accel: number; ta: number; vpeak: number; duration: number }

export function makeProfile(length: number, vmax: number, accel: number): Profile {
  if (length <= 0) return { length: 0, vmax, accel, ta: 0, vpeak: 0, duration: 0 }
  const dAccel = (vmax * vmax) / (2 * accel)
  if (length >= 2 * dAccel) {
    const ta = vmax / accel
    return { length, vmax, accel, ta, vpeak: vmax, duration: 2 * ta + (length - 2 * dAccel) / vmax }
  }
  const vpeak = Math.sqrt(length * accel)
  const ta = vpeak / accel
  return { length, vmax, accel, ta, vpeak, duration: 2 * ta }
}

/** Distance travelled `t` seconds into the profile. */
export function distanceAt(p: Profile, t: number): number {
  if (t <= 0) return 0
  if (t >= p.duration) return p.length
  const dA = 0.5 * p.accel * p.ta * p.ta
  if (t < p.ta) return 0.5 * p.accel * t * t
  const cruiseEnd = p.duration - p.ta
  if (t <= cruiseEnd) return dA + p.vpeak * (t - p.ta)
  const td = p.duration - t
  return p.length - 0.5 * p.accel * td * td
}

export function speedAt(p: Profile, t: number): number {
  if (t <= 0 || t >= p.duration) return 0
  if (t < p.ta) return p.accel * t
  if (t > p.duration - p.ta) return p.accel * (p.duration - t)
  return p.vpeak
}
