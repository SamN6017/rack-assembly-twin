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
    for (const id of ['kanban:nope#0:0', 'rack:WS99', 'pou:WS1:000', 'finished:99', 'dsv:-1', 'garbage']) {
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

  it('give base rack a POU at WS1 with one rack per pallet', () => {
    const c = COMPONENTS.get('1225629')!
    expect(c.pouDestination?.station).toBe('WS1')
    expect(c.inventory.perKanban).toBe(22)
  })

  it('list station consumption including shared WS7 & WS8 parts', () => {
    const ws8 = stationParts('WS8').kanban.map((p) => p.description)
    expect(ws8).toContain('Left Drain Module')
    expect(ws8).toContain('Center Rack Cable Manager')
  })
})
