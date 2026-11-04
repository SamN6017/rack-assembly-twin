import { describe, expect, it } from 'vitest'
import { KANBAN_PARTS } from '../data/parts'
import { PICK_AISLE, ROW_SETBACK, PALLET } from './constants'
import { KANBAN_ORDER, LAYOUT, inside, overlaps, palletRect, rackFootprint } from './factoryLayout'

describe('Kanban area', () => {
  it('orders every part number exactly once', () => {
    expect([...KANBAN_ORDER].sort()).toEqual(KANBAN_PARTS.map((p) => p.pn).sort())
  })

  it('places exactly two Kanbans for every part number', () => {
    for (const part of KANBAN_PARTS) {
      const slots = LAYOUT.slots.filter((s) => s.pn === part.pn)
      expect(slots.map((s) => s.index).sort(), part.pn).toEqual([0, 1])
    }
    expect(LAYOUT.slots).toHaveLength(KANBAN_PARTS.length * 2)
  })

  it('gives each Kanban the pallet count from the sheet', () => {
    for (const slot of LAYOUT.slots) {
      const part = KANBAN_PARTS.find((p) => p.pn === slot.pn)!
      expect(slot.pallets).toHaveLength(part.kanbanPallets)
    }
  })

  it('keeps every pallet inside its slot and the Kanban area', () => {
    for (const slot of LAYOUT.slots) {
      for (const p of slot.pallets) {
        const r = palletRect(p)
        expect(r.minX >= slot.rect.minX && r.maxX <= slot.rect.maxX && r.minZ >= slot.rect.minZ && r.maxZ <= slot.rect.maxZ, slot.id).toBe(true)
        expect(inside(p, LAYOUT.kanbanArea)).toBe(true)
      }
    }
  })

  it('puts every pallet one deep, facing its pick aisle', () => {
    const faceGap = ROW_SETBACK + PALLET.length / 2 + PICK_AISLE / 2
    for (const slot of LAYOUT.slots) {
      const aisle = LAYOUT.aisles.find((a) => a.id === slot.aisleId)!
      for (const p of slot.pallets) expect(Math.abs(Math.abs(p.z - aisle.z) - faceGap), slot.id).toBeLessThan(1e-6)
    }
  })

  it('has no overlapping slots and keeps aisles clear', () => {
    const { slots, aisles } = LAYOUT
    for (let i = 0; i < slots.length; i++) {
      for (const a of aisles) expect(overlaps(slots[i].rect, a.rect), `${slots[i].id} in ${a.id}`).toBe(false)
      for (let j = i + 1; j < slots.length; j++) {
        expect(overlaps(slots[i].rect, slots[j].rect), `${slots[i].id} vs ${slots[j].id}`).toBe(false)
      }
    }
  })
})

describe('Production line', () => {
  it('stages one POU pallet per part at the station that uses it', () => {
    const staged = LAYOUT.stations.flatMap((s) => s.pou.map((p) => p.pn))
    const expected = KANBAN_PARTS.filter((p) => p.workstation).map((p) => p.pn)
    expect(staged.sort()).toEqual(expected.sort())
  })

  it('keeps POU pallets and racks from colliding', () => {
    const rects = LAYOUT.stations.flatMap((s) => [...s.pou.map((p) => palletRect(p, true)), rackFootprint(s.rack)])
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false)
    }
  })
})

describe('Building', () => {
  it('keeps everything inside the walls', () => {
    const pts = [
      ...LAYOUT.slots.flatMap((s) => s.pallets),
      ...LAYOUT.stations.map((s) => s.rack),
      ...LAYOUT.rackingBays,
      ...LAYOUT.finishedRackSpots,
      ...LAYOUT.parkingSpots,
      ...LAYOUT.smallPartsRacks,
    ]
    for (const p of pts) expect(inside(p, LAYOUT.building, -0.5)).toBe(true)
  })

  it('never puts a column on a pallet or rack', () => {
    const rects = [
      ...LAYOUT.slots.flatMap((s) => s.pallets.map((p) => palletRect(p))),
      ...LAYOUT.stations.flatMap((s) => [rackFootprint(s.rack), ...s.pou.map((p) => palletRect(p, true))]),
    ]
    for (const c of LAYOUT.columns) {
      const col = { minX: c.x - 0.3, maxX: c.x + 0.3, minZ: c.z - 0.3, maxZ: c.z + 0.3 }
      for (const r of rects) expect(overlaps(col, r)).toBe(false)
    }
  })
})
