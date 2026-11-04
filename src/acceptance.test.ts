import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { ASSETS, validateBounds, type AssetId } from './assets/manifest'
import { getPart } from './data/parts'
import { LAYOUT } from './layout/factoryLayout'
import { resolveEntity } from './scene/entities'
import { computeKpis } from './sim/kpis'
import { DEFAULT_MOVEMENT, isTracked, poseAt, runMovementSim, snapshotAt, type MovementConfig, type MovementResult } from './sim/movementSim'
import { distanceToRect, OBSTACLES } from './sim/obstacles'
import { GRAPH } from './sim/routeGraph'
import { capsuleOf } from './sim/timeline'
import { simClock, useSim } from './store/simStore'

/**
 * The brief's twelve acceptance tests (section 12), one block each, run against the real engine.
 * Unit tests for the individual modules live next to them; this file is the sign-off list.
 */

let base: MovementResult
let busy: MovementResult
const run = (c: Partial<MovementConfig>) => runMovementSim({ ...DEFAULT_MOVEMENT, ...c })

beforeAll(() => {
  base = run({})
  busy = run({ ratePerHour: 8 })
})

const station = (id: string) => LAYOUT.stations.find((s) => s.id === id)!

/** Uniform grid over the floor so pose checks only test nearby items (rects or segments). */
function gridIndex<T>(items: T[], bbox: (x: T) => { minX: number; maxX: number; minZ: number; maxZ: number }, cell = 2) {
  const cells = new Map<string, T[]>()
  const key = (i: number, j: number) => `${i},${j}`
  for (const it of items) {
    const b = bbox(it)
    for (let i = Math.floor(b.minX / cell) - 1; i <= Math.floor(b.maxX / cell) + 1; i++)
      for (let j = Math.floor(b.minZ / cell) - 1; j <= Math.floor(b.maxZ / cell) + 1; j++) {
        const list = cells.get(key(i, j)) ?? []
        list.push(it)
        cells.set(key(i, j), list)
      }
  }
  return (x: number, z: number) => cells.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? []
}

/** The task a handler is working on at t (tasks per handler are sequential). */
function taskAt(r: MovementResult, handler: string) {
  const list = r.tasks.filter((x) => x.handler === handler)
  let i = 0
  return (t: number) => {
    while (i < list.length && list[i].doneAt < t) i++
    return list[i] && list[i].dispatchedAt <= t ? list[i] : undefined
  }
}
const qpp = (pn: string) => getPart(pn).qtyPerPallet ?? 0

describe('acceptance', () => {
  it('1. at baseline demand, inventory decreases according to the bill of materials', () => {
    // Every rack takes exactly its BOM quantity of each tracked part at each station it visits...
    let expected = 0
    for (const e of base.inventory) {
      if (e.kind !== 'rack') continue
      const visits = e.station === 'WS4' ? [station('WS4'), station('SUBASSY')] : [station(e.station)]
      for (const v of visits) for (const p of v.pou) {
        const part = getPart(p.pn)
        if (isTracked(part) && part.models.includes(e.model)) expected += part.qtyPerRack!
      }
    }
    expect(snapshotAt(base, base.horizon).consumed).toBe(expected)
    // ...and each consumption lowers that POU by exactly the BOM quantity.
    const last = new Map<string, number>()
    for (const e of base.inventory) {
      if (e.kind !== 'pou') continue
      const prev = last.get(e.key)
      if (prev !== undefined && e.consumed > 0) {
        const part = getPart(e.key.split(':')[1])
        expect(e.consumed, e.key).toBe(part.qtyPerRack)
        expect(e.pieces, `${e.key} at ${e.t}`).toBe(prev - part.qtyPerRack!)
      }
      last.set(e.key, e.pieces)
    }
    expect(base.stats.racksCompleted).toBe(base.targetRacks)
  })

  it('2. empty Kanbans create replenishment requests', () => {
    const interval = DEFAULT_MOVEMENT.inspectionIntervalMin * 60
    let checked = 0
    for (const r of [base, busy]) for (const c of r.cycles) {
      if (c.emptyAt + interval > r.horizon) continue
      expect(c.requestedAt, `${c.slotId} emptied ${c.emptyAt}`).toBeDefined()
      expect(r.inspections).toContain(c.requestedAt)
      checked++
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('3. material handlers follow valid routes (corridors and spurs only)', () => {
    const segs = [
      ...LAYOUT.corridors.map((c) => [c.a, c.b] as const),
      ...[...GRAPH.dwells.values()].map((d) => [d.junction, d.pos] as const),
    ]
    const near = gridIndex(segs, ([a, b]) => ({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) }))
    const off = (p: { x: number; z: number }) => Math.min(Infinity, ...near(p.x, p.z).map(([a, b]) => {
      const dx = b.x - a.x, dz = b.z - a.z
      const L2 = dx * dx + dz * dz
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2)) : 0
      return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z)
    }))
    // 1 m corner fillets cut a corner by at most r(√2 − 1) ≈ 0.42 m.
    for (const h of busy.handlers) for (let t = 0; t < busy.horizon; t += 2) {
      const p = poseAt(h, t)
      expect(off(p), `${h.id} at ${t}s (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBeLessThan(0.43)
    }
  }, 60000)

  it('4. delivered material appears in the correct destination inventory', () => {
    for (const task of busy.tasks) {
      if (task.deliveredAt > busy.horizon) continue
      const before = snapshotAt(busy, task.deliveredAt - 1e-3)
      if (task.kind === 'pou-delivery') {
        const key = task.to.replace(/^pou:/, '')
        const ev = busy.inventory.find((e) => e.kind === 'pou' && e.key === key && e.t === task.deliveredAt)
        expect(ev, task.id).toBeDefined()
        if (ev?.kind === 'pou') expect(ev.pieces + ev.consumed, task.id).toBe(before.pou.get(key)! + qpp(task.pn!))
      } else {
        const slotId = task.to.replace(/^kp:/, '').replace(/:\d+$/, '')
        expect(snapshotAt(busy, task.deliveredAt).kanban.get(slotId), task.id).toBe(before.kanban.get(slotId)! + 1)
      }
    }
  })

  it('5. a material shortage can block production', () => {
    const r = run({ stock: { '1181838-03': { kanban: 0, pou: 0 } } })
    expect(r.blocks[0]).toMatchObject({ from: 0 })
    expect(r.blocks[0].keys).toContain('WS5:1181838-03')
    expect(snapshotAt(r, 1800).line.blocked).toBe(true)
    expect(r.stats.racksCompleted).toBeLessThan(r.targetRacks)
    expect(busy.stats.blockedSec).toBeGreaterThan(0)
  })

  it('6. increasing demand reduces inventory coverage when all else is unchanged', () => {
    const k5 = computeKpis(base), k8 = computeKpis(busy)
    const start5 = new Map(k5.coverage.map((c) => [c.pn, c.startH]))
    for (const c of k8.coverage) expect(c.startH, c.pn).toBeLessThan(start5.get(c.pn)!)
    const mean = (k: typeof k5) => k.coverage.reduce((a, c) => a + c.minH, 0) / k.coverage.length
    expect(mean(k8)).toBeLessThan(mean(k5))
  })

  it('7. pausing freezes event progression and animation', () => {
    const s = useSim.getState()
    s.loadScenario('baseline')
    s.seek(3000)
    s.pause()
    const snap = useSim.getState().snapshot
    const poses = useSim.getState().result.handlers.map((h) => poseAt(h, simClock.t))
    for (let i = 0; i < 600; i++) useSim.getState().tick(1 / 60)
    expect(simClock.t).toBe(3000)
    expect(useSim.getState().snapshot).toBe(snap)
    expect(useSim.getState().result.handlers.map((h) => poseAt(h, simClock.t))).toEqual(poses)
  })

  it('8. changing playback speed does not change the simulated outcome', () => {
    const at = (speed: 1 | 10, ticks: number) => {
      const s = useSim.getState()
      s.loadScenario('baseline')
      s.setSpeed(speed)
      s.play()
      for (let i = 0; i < ticks; i++) useSim.getState().tick(0.1)
      useSim.getState().pause()
      return { t: simClock.t, snap: useSim.getState().snapshot, result: useSim.getState().result }
    }
    const slow = at(1, 1200)   // 120 s of simulated time at 1×
    const fast = at(10, 120)   // the same 120 s at 10×
    // 1200 × 0.1 s and 120 × 1 s land within float rounding of each other.
    expect(fast.t).toBeCloseTo(slow.t, 6)
    expect(fast.snap).toEqual(slow.snap)
    expect(fast.result.inventory).toEqual(slow.result.inventory)
    // Identical timelines, so animation at any instant is identical too.
    expect(fast.result.handlers).toEqual(slow.result.handlers)
    expect(fast.result.handlers.map((h) => poseAt(h, slow.t))).toEqual(slow.result.handlers.map((h) => poseAt(h, slow.t)))
  })

  it('9. resetting with the same seed reproduces the same results', () => {
    const again = run({ ratePerHour: 8 })
    expect(again.inventory).toEqual(busy.inventory)
    expect(again.tasks).toEqual(busy.tasks)
    expect(again.blocks).toEqual(busy.blocks)
    const s = useSim.getState()
    s.loadScenario('baseline')
    const fresh = useSim.getState().snapshot
    s.seek(5000)
    useSim.getState().reset()
    expect(simClock.t).toBe(0)
    expect(useSim.getState().snapshot).toEqual(fresh)
    // A different seed is a genuinely different run.
    expect(run({ seed: 8 }).inventory).not.toEqual(base.inventory)
  })

  it('10. total inventory is conserved across storage, POU, in transit and consumed', () => {
    for (const r of [base, busy]) for (let t = 13; t < r.horizon; t += 173) {
      const s = snapshotAt(r, t)
      let kanban = 0
      for (const slot of LAYOUT.slots) if (isTracked(getPart(slot.pn))) kanban += s.kanban.get(slot.id)! * qpp(slot.pn)
      const pou = [...s.pou.values()].reduce((a, b) => a + b, 0)
      const staged = s.stage.reduce((a, pn) => a + (pn ? qpp(pn) : 0), 0)
      const carried = r.handlers.reduce((a, h) => { const l = poseAt(h, t).load; return a + (l ? qpp(l.pn) : 0) }, 0)
      // DSV staging is the only modelled receipt into the floor stock.
      expect(kanban + pou + staged + carried + s.consumed, `t=${t}`).toBe(r.initialPieces + s.received)
    }
  })

  it('11. every 3D model loads at the correct scale and location', () => {
    // Procedural models match their manifest dimensions and sit on the floor.
    for (const id of Object.keys(ASSETS) as AssetId[]) {
      const box = new THREE.Box3()
      for (const p of ASSETS[id].build().build()) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!) }
      const size = box.getSize(new THREE.Vector3()).toArray() as [number, number, number]
      expect(validateBounds(id, size, box.min.y), id).toBeNull()
    }
    // A GLB exported in centimetres, lying on its side, or floating is rejected.
    const [w, h, d] = ASSETS.pallet.dims
    expect(validateBounds('pallet', [w * 100, h * 100, d * 100], 0)).toMatch(/does not match/)
    expect(validateBounds('rackFrame', [ASSETS.rackFrame.dims[1], ASSETS.rackFrame.dims[0], ASSETS.rackFrame.dims[2]], 0)).toMatch(/does not match/)
    expect(validateBounds('pallet', [w, h, d], 0.4)).toMatch(/origin/)
    // Every placed model sits on the floor, inside the building. (Station entities are padded
    // selection frames, not models, so they are left out.)
    const b = LAYOUT.building
    const ids = [
      ...LAYOUT.slots.flatMap((s) => s.pallets.map((_, i) => `kanban:${s.id}:${i}`)),
      ...LAYOUT.stations.flatMap((s) => s.pou.map((p) => `pou:${s.id}:${p.pn}`)),
      ...LAYOUT.stations.filter((s) => s.id !== 'SUBASSY').map((s) => `rack:${s.id}`),
    ]
    for (const id of ids) {
      const e = resolveEntity(id)!.bounds
      expect(e.y - e.h / 2, id).toBeGreaterThanOrEqual(-1e-6)
      expect(e.x - e.w / 2 >= b.minX && e.x + e.w / 2 <= b.maxX && e.z - e.d / 2 >= b.minZ && e.z + e.d / 2 <= b.maxZ, id).toBe(true)
    }
  })

  it('12. no transport crosses walls, storage racks or equipment', () => {
    const near = gridIndex(OBSTACLES, (o) => o.rect)
    let samples = 0
    for (const r of [base, busy]) for (const h of r.handlers) {
      const current = taskAt(r, h.id)
      for (let t = 0; t < r.horizon; t += 1) {
        const c = capsuleOf(poseAt(h, t))
        const task = current(t)
        // Body centreline (forks to operator) never enters a wall, rack, column, equipment, or any
        // pallet position other than the one being picked from or dropped at.
        for (let k = 0; k <= 8; k++) {
          const p = { x: c.a.x + (c.b.x - c.a.x) * (k / 8), z: c.a.z + (c.b.z - c.a.z) * (k / 8) }
          for (const o of near(p.x, p.z)) {
            if (task && (o.id === task.from || o.id === task.to)) continue
            if (distanceToRect(p, o.rect) <= 0) expect.fail(`${h.id} at ${t}s: body inside ${o.id} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`)
          }
          samples++
        }
      }
    }
    expect(samples).toBeGreaterThan(100000)
  }, 120000)
})
