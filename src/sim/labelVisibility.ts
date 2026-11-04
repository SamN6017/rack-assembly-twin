import { SERVER_RACK, RACKING } from '../layout/constants'
import { OBSTACLES } from './obstacles'

/**
 * When a floating label is worth showing. Pure and cheap: occlusion is a line-of-sight test against
 * the layout's solid boxes (no scene raycasts), so it can run for every candidate label a few
 * times a second.
 */

export interface P3 { x: number; y: number; z: number }
interface Box { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

/** Height of each kind of obstacle, metres (estimates matching the scene's models). */
function heightOf(id: string): number {
  if (id === 'wall' || id === 'column') return 10
  if (id === 'racking') return RACKING.height
  if (id.startsWith('kp:') || id.startsWith('pou:') || id.startsWith('stage:')) return 1.3
  if (id.startsWith('rack:') || id === 'finished-rack') return SERVER_RACK.height
  if (id.startsWith('bench:') || id === 'two-bin') return 1.9
  if (id === 'kanban-board') return 2.15
  if (id === 'cart') return 1.05
  if (id.startsWith('conveyor:')) return 0.3
  return 1.5
}

export const OCCLUDERS: Box[] = OBSTACLES.map((o) => ({ ...o.rect, minY: 0, maxY: heightOf(o.id) }))

/** Slab test: does the segment a→b pass through the box (ignoring the last few cm at b)? */
function hits(a: P3, b: P3, box: Box): boolean {
  let t0 = 0, t1 = 0.98
  for (const [p, q, lo, hi] of [[a.x, b.x, box.minX, box.maxX], [a.y, b.y, box.minY, box.maxY], [a.z, b.z, box.minZ, box.maxZ]] as const) {
    const d = q - p
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false
      continue
    }
    let u0 = (lo - p) / d, u1 = (hi - p) / d
    if (u0 > u1) [u0, u1] = [u1, u0]
    t0 = Math.max(t0, u0)
    t1 = Math.min(t1, u1)
    if (t0 > t1) return false
  }
  return true
}

/** True when nothing solid stands between the eye and the label. */
export function lineOfSight(eye: P3, label: P3): boolean {
  const minX = Math.min(eye.x, label.x), maxX = Math.max(eye.x, label.x)
  const minZ = Math.min(eye.z, label.z), maxZ = Math.max(eye.z, label.z)
  for (const b of OCCLUDERS) {
    if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue
    if (hits(eye, label, b)) return false
  }
  return true
}

/** First-person label range: appear inside SHOW, disappear beyond HIDE (hysteresis, no flicker). */
export const WALK_LABEL_RANGE = { show: 7, hide: 8.5 }
/** Half-angle of the view cone a label must be inside, radians (a little inside the screen edge). */
export const WALK_LABEL_CONE = (50 * Math.PI) / 180

/**
 * Whether a label should show in first-person: near (with hysteresis on its previous state), in
 * front of the camera, and not behind anything solid. `forward` is the camera's unit look vector.
 */
export function walkLabelVisible(eye: P3, forward: P3, label: P3, wasVisible: boolean): boolean {
  const dx = label.x - eye.x, dy = label.y - eye.y, dz = label.z - eye.z
  const d = Math.hypot(dx, dy, dz)
  if (d > (wasVisible ? WALK_LABEL_RANGE.hide : WALK_LABEL_RANGE.show)) return false
  if (d > 0.3) {
    const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / d
    if (cos < Math.cos(WALK_LABEL_CONE)) return false
  }
  return lineOfSight(eye, label)
}

export interface ScreenRect { x: number; y: number; w: number; h: number }

/**
 * Greedy declutter: walk labels in priority order and keep each one only if its screen rectangle
 * (with a small margin) does not overlap one already kept. Returns the kept indices.
 */
export function declutter(rects: (ScreenRect | null)[], order: number[], margin = 4): Set<number> {
  const kept: ScreenRect[] = []
  const out = new Set<number>()
  for (const i of order) {
    const r = rects[i]
    if (!r) continue
    const clash = kept.some((k) => r.x - margin < k.x + k.w && r.x + r.w + margin > k.x && r.y - margin < k.y + k.h && r.y + r.h + margin > k.y)
    if (clash) continue
    kept.push(r)
    out.add(i)
  }
  return out
}
