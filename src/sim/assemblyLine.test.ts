import { beforeAll, describe, expect, it } from 'vitest'
import { LAYOUT } from '../layout/factoryLayout'
import { SERVER_RACK, WORKER } from '../layout/constants'
import { blockAt, lineIndexAt, LINE_STATIONS, N_STATIONS, rackAt, racksAt, stagingSpot, stationAt, type RackView } from './assemblyLine'
import { DEFAULT_MOVEMENT, runMovementSim, snapshotAt, type MovementResult } from './movementSim'
import { OBSTACLES, distanceToRect } from './obstacles'

let base: MovementResult
let busy: MovementResult
let fast: MovementResult

beforeAll(() => {
  base = runMovementSim(DEFAULT_MOVEMENT)
  busy = runMovementSim({ ...DEFAULT_MOVEMENT, ratePerHour: 8 })
  fast = runMovementSim({ ...DEFAULT_MOVEMENT, ratePerHour: 12, shiftH: 4, shortage: 'pass' })
})

/** Rack footprint on the floor: depth 1.2 m along X (front faces the bench), width 0.6 m along Z. */
const foot = (v: RackView) => ({ minX: v.x - SERVER_RACK.depth / 2, maxX: v.x + SERVER_RACK.depth / 2, minZ: v.z - SERVER_RACK.width / 2, maxZ: v.z + SERVER_RACK.width / 2 })
const gap = (a: ReturnType<typeof foot>, b: ReturnType<typeof foot>) =>
  Math.max(a.minX - b.maxX, b.minX - a.maxX, a.minZ - b.maxZ, b.minZ - a.maxZ)

describe('assembly line', () => {
  it('takes every rack from WS1 through WS8 to finished staging, in order', () => {
    for (const r of [0, 3, 10]) {
      let lastStation = -1
      const seen = new Set<number>()
      const assembledAt = new Set<number>()
      let completed: RackView | null = null
      for (let t = base.indexTimes[r]; t <= base.horizon; t += 5) {
        const v = rackAt(base, r, t)!
        expect(v, `rack ${r} at ${t}`).not.toBeNull()
        if (v.station !== null) {
          expect(v.station, `rack ${r} never goes back`).toBeGreaterThanOrEqual(lastStation)
          lastStation = v.station
          seen.add(v.station)
          if (v.state === 'ASSEMBLING') assembledAt.add(v.station)
        }
        if (v.state === 'COMPLETED') { completed = v; break }
      }
      expect([...seen].sort((a, b) => a - b)).toEqual([...Array(N_STATIONS).keys()])
      expect(assembledAt.size, `rack ${r} assembled at every station`).toBe(N_STATIONS)
      expect(completed, `rack ${r} reaches staging`).not.toBeNull()
      const spot = stagingSpot(r - base.firstRack)
      expect(completed!.x).toBeCloseTo(spot.x, 9)
      expect(completed!.z).toBeCloseTo(spot.z, 9)
      expect(completed!.y).toBe(0)
      expect(completed!.stationsDone).toBe(N_STATIONS)
    }
  })

  it('moves racks smoothly: no teleporting, within conveyor speed', () => {
    const vmax = Math.max(DEFAULT_MOVEMENT.conveyorSpeed, DEFAULT_MOVEMENT.outfeedSpeed)
    for (const r of [-7, -3, 0, 5]) {
      let prev = rackAt(busy, r, 0)
      for (let t = 0.5; t < busy.horizon; t += 0.5) {
        const v = rackAt(busy, r, t)
        if (prev && v) {
          expect(Math.hypot(v.x - prev.x, v.z - prev.z), `rack ${r} at ${t}`).toBeLessThanOrEqual(vmax * 0.5 + 1e-6)
          expect(Math.abs(v.y - prev.y)).toBeLessThan(0.2)
        }
        prev = v ?? prev
      }
    }
  }, 30000)

  it('keeps one rack per station and never lets racks touch', () => {
    for (const r of [base, busy, fast]) {
      for (let t = 0; t < r.horizon; t += 7) {
        const racks = racksAt(r, t)
        const byStation = new Map<number, number>()
        for (const v of racks) if (v.station !== null) byStation.set(v.station, (byStation.get(v.station) ?? 0) + 1)
        for (const [k, n] of byStation) expect(n, `station ${k} at ${t}`).toBe(1)
        for (let i = 0; i < racks.length; i++) for (let j = i + 1; j < racks.length; j++) {
          expect(gap(foot(racks[i]), foot(racks[j])), `${racks[i].id} / ${racks[j].id} at ${t}`).toBeGreaterThan(0.2)
        }
      }
    }
  }, 30000)

  it('never moves a rack on before its station has finished', () => {
    for (const r of [base, busy]) {
      for (let j = 1; j < r.indexTimes.length; j++) expect(r.indexTimes[j] - r.indexTimes[j - 1]).toBeGreaterThanOrEqual(r.takt - 1e-9)
      expect(r.assemblyS).toBeCloseTo(r.takt - r.transferS, 9)
      expect(r.transferS).toBeGreaterThan(0)
    }
  })

  it('freezes the whole line while it is stopped for material', () => {
    expect(busy.blocks.length).toBeGreaterThan(0)
    for (const b of busy.blocks.filter((x) => x.to !== undefined && x.to - x.from > 10)) {
      const a = racksAt(busy, b.from + 1).filter((v) => v.station !== null)
      const z = racksAt(busy, b.to! - 1).filter((v) => v.station !== null)
      expect(z.map((v) => [v.id, v.x, v.z])).toEqual(a.map((v) => [v.id, v.x, v.z]))
      const states = LINE_STATIONS.map((_, k) => stationAt(busy, k, b.from + 1))
      for (const s of states) expect(['waiting', 'blocked'], `${s.id} at ${b.from + 1}`).toContain(s.state)
      expect(states.some((s) => s.state === 'blocked' && s.short.length > 0)).toBe(true)
      expect(blockAt(busy, b.from + 1)).toBe(b)
    }
  })

  it('consumes material only when a rack has arrived at the station', () => {
    const arrivals = new Set(base.indexTimes.map((t) => t + base.transferS))
    let n = 0
    for (const e of base.inventory) {
      if (e.kind !== 'pou' || e.consumed === 0) continue
      expect(arrivals.has(e.t), `${e.key} consumed at ${e.t}`).toBe(true)
      const k = LINE_STATIONS.findIndex((s) => s.id === e.key.split(':')[0])
      const st = stationAt(base, k < 0 ? 3 : k, e.t)
      expect(st.state, `${e.key} at ${e.t}`).toBe('assembling')
      n++
    }
    expect(n).toBeGreaterThan(100)
  })

  it('counts a rack complete when WS8 finishes it, matching the production counter', () => {
    for (const r of [base, busy]) {
      for (let t = 600; t <= r.horizon; t += 977) {
        const j = lineIndexAt(r, t)
        let done = 0
        for (let rack = r.firstRack; rack <= j; rack++) {
          const v = rackAt(r, rack, t)
          if (v?.completedAt !== null && v?.completedAt !== undefined && v.completedAt <= t) done++
        }
        expect(done, `t=${t}`).toBe(snapshotAt(r, t).racksCompleted)
      }
    }
    expect(base.stats.racksCompleted).toBe(base.targetRacks)
  })

  it('assembles only at stations that hold a rack, and is deterministic', () => {
    for (let t = 0; t < base.horizon; t += 113) {
      for (let k = 0; k < N_STATIONS; k++) {
        const s = stationAt(base, k, t)
        if (s.state === 'assembling') {
          expect(s.rack?.station).toBe(k)
          expect(s.rack?.state).toBe('ASSEMBLING')
          expect(s.remaining).toBeGreaterThan(0)
        }
      }
    }
    expect(racksAt(base, 12345)).toEqual(racksAt(runMovementSim(DEFAULT_MOVEMENT), 12345))
  })

  it('places two workers per station clear of the conveyor, benches, pallets and each other', () => {
    expect(LAYOUT.workers).toHaveLength(N_STATIONS * 2)
    const solid = OBSTACLES.filter((o) => /^(conveyor|bench|pou|rack):/.test(o.id))
    for (const w of LAYOUT.workers) {
      for (const o of solid) expect(distanceToRect(w, o.rect), `${w.id} vs ${o.id}`).toBeGreaterThan(WORKER.radius)
      for (const o of LAYOUT.workers) if (o !== w) expect(Math.hypot(o.x - w.x, o.z - w.z), `${w.id} vs ${o.id}`).toBeGreaterThan(2 * WORKER.radius)
    }
  })
})
