import { describe, expect, it } from 'vitest'
import { COMPONENTS, stationParts } from '../data/components'
import { KANBAN_PARTS } from '../data/parts'
import { LAYOUT } from '../layout/factoryLayout'
import { DSV_STOCK, EQUIPMENT, resolveEntity } from './entities'

describe('entity ids', () => {
  it('resolve for every pickable object in the layout', () => {
    const ids = [
      ...LAYOUT.slots.flatMap((s) => s.pallets.map((_, p) => `kanban:${s.id}:${p}`)),
      ...LAYOUT.stations.flatMap((s) => [`station:${s.id}`, ...s.pou.map((p) => `pou:${s.id}:${p.pn}`)]),
      ...LAYOUT.stations.filter((s) => s.id !== 'SUBASSY').map((s) => `rack:${s.id}`),
      ...LAYOUT.finishedRackSpots.map((_, i) => `finished:${i}`),
      ...DSV_STOCK.map((_, i) => `dsv:${i}`),
    ]
    for (const id of ids) expect(resolveEntity(id), id).not.toBeNull()
    expect(EQUIPMENT.length).toBeGreaterThan(0)
  })

  it('reject malformed ids', () => {
    for (const id of ['kanban:nope#0:0', 'rack:ST99', 'pou:ST1:000', 'finished:99', 'dsv:-1', 'garbage']) {
      expect(resolveEntity(id), id).toBeNull()
    }
  })

  it('carry the part number for pallets', () => {
    const slot = LAYOUT.slots[0]
    expect(resolveEntity(`kanban:${slot.id}:0`)?.pn).toBe(slot.pn)
  })
})

describe('component records', () => {
  it('exist for every Kanban part with storage and inventory', () => {
    for (const part of KANBAN_PARTS) {
      const c = COMPONENTS.get(part.pn)!
      expect(c.storageSlots).toHaveLength(2)
      if (part.qtyPerPallet !== null) expect(c.inventory.perKanban).toBe(part.kanbanPallets * part.qtyPerPallet)
    }
  })

  it('give base rack a POU at the chassis station with one rack per pallet', () => {
    const c = COMPONENTS.get('1225629')!
    expect(c.pouDestination?.station).toBe('ST1')
    expect(c.inventory.perKanban).toBe(22)
  })

  it('list station consumption, mapping the sheet steps onto the five line stations', () => {
    // Wiring does sheet steps WS7 and WS8, including the shared "WS7 & WS8" drain modules.
    const wiring = stationParts('ST3').kanban.map((p) => p.description)
    expect(wiring).toContain('Left Drain Module')
    expect(wiring).toContain('Center Rack Cable Manager')
    // Testing has no rows in the sheet; packout fits the WS10 shipping brackets.
    expect(stationParts('ST4').kanban).toHaveLength(0)
    expect(stationParts('ST5').kanban.map((p) => p.description)).toEqual(['Right Shipping Bracket', 'Left Shipping Bracket', 'Front Shipping Bracket'])
    // Every pallet part with a sheet step lands on a station.
    for (const p of KANBAN_PARTS) expect(p.station, p.description).not.toBeNull()
  })
})
