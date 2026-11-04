import { RACKING } from '../layout/constants'
import { LAYOUT, palletRect, rackFootprint, type FactoryLayout, type Rect } from '../layout/factoryLayout'
import type { Vec2 } from './path'

export interface Obstacle { id: string; rect: Rect }

const box = (c: Vec2, w: number, d: number): Rect => ({ minX: c.x - w / 2, maxX: c.x + w / 2, minZ: c.z - d / 2, maxZ: c.z + d / 2 })

/** Everything a moving handler must keep clear of, as axis-aligned footprints. */
export function buildObstacles(layout: FactoryLayout): Obstacle[] {
  const out: Obstacle[] = []
  for (const s of layout.slots) s.pallets.forEach((p, i) => out.push({ id: `kp:${s.id}:${i}`, rect: palletRect(p) }))
  for (const st of layout.stations) {
    for (const p of st.pou) out.push({ id: `pou:${st.id}:${p.pn}`, rect: palletRect(p, true) })
    out.push({ id: `rack:${st.id}`, rect: rackFootprint(st.rack) })
    out.push({ id: `bench:${st.id}`, rect: st.id === 'SUBASSY' ? box(st.bench, 1.8, 0.75) : box(st.bench, 0.75, 1.8) })
  }
  layout.stagingSlots.forEach((p, i) => out.push({ id: `stage:${i}`, rect: palletRect(p, true) }))
  for (const b of layout.rackingBays) out.push({ id: 'racking', rect: box(b, RACKING.depth, RACKING.bayWidth) })
  for (const c of layout.columns) out.push({ id: 'column', rect: box(c, 0.6, 0.6) })
  out.push({ id: 'kanban-board', rect: box(layout.kanbanBoard, 0.6, 3.7) })
  for (const p of layout.smallPartsRacks) out.push({ id: 'two-bin', rect: box(p, 1.8, 0.6) })
  for (const p of layout.carts) out.push({ id: 'cart', rect: box(p, 0.8, 1.4) })
  for (const p of layout.finishedRackSpots) out.push({ id: 'finished-rack', rect: box(p, 1.2, 0.6) })
  layout.conveyor.rects.forEach((r, i) => out.push({ id: `conveyor:${i}`, rect: r }))
  const b = layout.building
  const t = 1
  out.push(
    { id: 'wall', rect: { minX: b.minX - t, maxX: b.maxX + t, minZ: b.minZ - t, maxZ: b.minZ } },
    { id: 'wall', rect: { minX: b.minX - t, maxX: b.maxX + t, minZ: b.maxZ, maxZ: b.maxZ + t } },
    { id: 'wall', rect: { minX: b.minX - t, maxX: b.minX, minZ: b.minZ, maxZ: b.maxZ } },
    { id: 'wall', rect: { minX: b.maxX, maxX: b.maxX + t, minZ: b.minZ, maxZ: b.maxZ } },
  )
  return out
}

export function distanceToRect(p: Vec2, r: Rect): number {
  const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX)
  const dz = Math.max(r.minZ - p.z, 0, p.z - r.maxZ)
  return Math.hypot(dx, dz)
}

export const OBSTACLES: Obstacle[] = buildObstacles(LAYOUT)
