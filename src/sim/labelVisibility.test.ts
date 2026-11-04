import { describe, expect, it } from 'vitest'
import { LAYOUT } from '../layout/factoryLayout'
import { declutter, lineOfSight, walkLabelVisible, WALK_LABEL_RANGE } from './labelVisibility'

const station = (id: string) => LAYOUT.stations.find((s) => s.id === id)!
const labelOf = (id: string) => ({ x: station(id).rack.x, y: 2.9, z: station(id).rack.z })
const eye = (x: number, z: number) => ({ x, y: 1.7, z })
const facing = (from: { x: number; z: number }, to: { x: number; z: number }) => {
  const dx = to.x - from.x, dz = to.z - from.z
  const d = Math.hypot(dx, dz)
  return { x: dx / d, y: 0, z: dz / d }
}

describe('label visibility', () => {
  it('shows a station label when standing near it and looking at it', () => {
    const at = eye(48.8, station('WS3').rack.z + 2)
    expect(walkLabelVisible(at, facing(at, labelOf('WS3')), labelOf('WS3'), false)).toBe(true)
  })

  it('hides labels that are far away, with hysteresis at the edge', () => {
    const lbl = labelOf('WS3')
    const at = eye(lbl.x - 1.5, lbl.z + 7.6)   // ~7.8 m: between show and hide distances
    const f = facing(at, lbl)
    expect(walkLabelVisible(at, f, lbl, false)).toBe(false)  // not shown yet: needs to come closer
    expect(walkLabelVisible(at, f, lbl, true)).toBe(true)    // already shown: stays until HIDE
    const far = eye(lbl.x - 1.5, lbl.z + WALK_LABEL_RANGE.hide + 2)
    expect(walkLabelVisible(far, facing(far, lbl), lbl, true)).toBe(false)
  })

  it('hides labels behind the viewer or off to the side', () => {
    const at = eye(48.8, station('WS3').rack.z + 2)
    const away = { x: 0, y: 0, z: 1 }   // looking down the line, WS3 behind
    expect(walkLabelVisible(at, away, labelOf('WS3'), false)).toBe(false)
  })

  it('hides labels behind walls and storage', () => {
    // From the DSV racking aisle, a label on the far side of a racking row is blocked.
    const bay = LAYOUT.rackingBays[Math.floor(LAYOUT.rackingBays.length / 2)]
    const a = { x: bay.x - 3, y: 1.7, z: bay.z }
    const b = { x: bay.x + 3, y: 1.7, z: bay.z }
    expect(lineOfSight(a, b)).toBe(false)
    // Outside the building, nothing is visible inside.
    expect(lineOfSight({ x: LAYOUT.building.maxX + 3, y: 1.7, z: 30 }, labelOf('WS4'))).toBe(false)
    // Across open floor, it is.
    expect(lineOfSight(eye(58, 20), eye(58, 40))).toBe(true)
  })

  it('declutters overlapping labels by priority', () => {
    const rects = [
      { x: 0, y: 0, w: 80, h: 20 },
      { x: 40, y: 5, w: 80, h: 20 },   // overlaps 0
      { x: 200, y: 0, w: 80, h: 20 },
      null,
    ]
    expect([...declutter(rects, [1, 0, 2, 3])].sort()).toEqual([1, 2])
    expect([...declutter(rects, [0, 1, 2, 3])].sort()).toEqual([0, 2])
  })
})
