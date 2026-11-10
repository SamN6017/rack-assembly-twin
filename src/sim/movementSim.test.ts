import { beforeAll, describe, expect, it } from 'vitest'
import { GRAPH } from './routeGraph'
import { getPart } from '../data/parts'
import { LAYOUT } from '../layout/factoryLayout'
import { DEFAULT_MOVEMENT, isTracked, poseAt, runMovementSim, snapshotAt, SUBASSY_FEEDS, type MovementConfig, type MovementResult } from './movementSim'
import { computeKpis } from './kpis'
import { capsuleGap, capsuleOf } from './timeline'

let result: MovementResult
let ms = 0

beforeAll(() => {
  const t = performance.now()
  result = runMovementSim(DEFAULT_MOVEMENT)
  ms = performance.now() - t
})

const times = (step: number, r: MovementResult = result) => Array.from({ length: Math.floor(r.horizon / step) }, (_, i) => i * step + step / 3)

/** Kanban + POU + staged + carried + fitted pieces must equal starting stock plus DSV receipts. */
function checkConservation(r: MovementResult, step: number) {
  const qpp = (pn: string) => getPart(pn).qtyPerPallet ?? 0
  for (const t of times(step, r)) {
    const s = snapshotAt(r, t)
    let kanban = 0
    for (const slot of LAYOUT.slots) if (isTracked(getPart(slot.pn))) kanban += s.kanban.get(slot.id)! * qpp(slot.pn)
    const pou = [...s.pou.values()].reduce((a, b) => a + b, 0)
    const staged = s.stage.reduce((a, pn) => a + (pn ? qpp(pn) : 0), 0)
    const carried = r.handlers.reduce((a, h) => { const l = poseAt(h, t).load; return a + (l ? qpp(l.pn) : 0) }, 0)
    expect(kanban + pou + staged + carried + s.consumed, `t=${t.toFixed(0)}`).toBe(r.initialPieces + s.received)
  }
}

const SCENARIOS: Record<string, Partial<MovementConfig>> = {
  rate8: { ratePerHour: 8 },
  pass8: { ratePerHour: 8, shortage: 'pass' },
  thirdKanban: { ratePerHour: 8, extraKanbanPns: ['1181838-03', '1219362-02'] },
  noTShelf: { stock: { '1181838-03': { kanban: 0, pou: 0 } } },
  lean: { clsHandlers: 1, inspectionIntervalMin: 120, pouReorderRacks: 2, clsPriority: 'line-stop-first' },
}
const runs = new Map<string, MovementResult>()
const run = (name: keyof typeof SCENARIOS) => {
  if (!runs.has(name)) runs.set(name, runMovementSim({ ...DEFAULT_MOVEMENT, ...SCENARIOS[name] }))
  return runs.get(name)!
}

describe('movement simulation', () => {
  it('runs a full shift quickly enough to compute in the browser', () => {
    expect(ms).toBeLessThan(4000)
    expect(result.stats.deliveries).toBeGreaterThan(50)
    expect(result.stats.refillTrips).toBeGreaterThan(0)
  })

  it('is deterministic for the same seed (acceptance 9)', () => {
    const again = runMovementSim(DEFAULT_MOVEMENT)
    expect(again.tasks).toEqual(result.tasks)
    expect(again.inventory).toEqual(result.inventory)
  })

  it('resolves every route conflict by waiting', () => {
    expect(result.stats.unresolvedConflicts).toBe(0)
  })

  it('never lets two handlers overlap', () => {
    let min = Infinity
    for (const t of times(0.5)) {
      const caps = result.handlers.map((h) => capsuleOf(poseAt(h, t)))
      for (let i = 0; i < caps.length; i++) for (let j = i + 1; j < caps.length; j++) min = Math.min(min, capsuleGap(caps[i], caps[j]))
    }
    expect(min).toBeGreaterThan(0)
  })

  it('never teleports: movement per 0.1 s stays within top speed (acceptance: no teleporting)', () => {
    const vmax = Math.max(DEFAULT_MOVEMENT.vEmpty, DEFAULT_MOVEMENT.vLoaded)
    for (const h of result.handlers) {
      let prev = poseAt(h, 0)
      let worst = 0
      for (let t = 0.1; t < result.horizon; t += 0.1) {
        const p = poseAt(h, t)
        worst = Math.max(worst, Math.hypot(p.x - prev.x, p.z - prev.z))
        prev = p
      }
      expect(worst, h.id).toBeLessThan(vmax * 0.1 + 1e-6)
    }
  }, 30000)

  it('has a continuous timeline with no gaps or overlaps', () => {
    for (const h of result.handlers) {
      for (let i = 1; i < h.segs.length; i++) expect(Math.abs(h.segs[i].t0 - h.segs[i - 1].t1), `${h.id} seg ${i}`).toBeLessThan(1e-6)
    }
  })

  it('conserves pieces across Kanban, POU, staging, forks and fitted racks (acceptance 10)', () => {
    checkConservation(result, 37)
  })

  it('conserves pieces in every scenario type (blocking, pass, third Kanban, reduced stock, lean staffing)', () => {
    for (const name of Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]) {
      const r = run(name)
      expect(r.stats.unresolvedConflicts, name).toBe(0)
      checkConservation(r, 211)
      for (const t of times(401, r)) for (const [k, v] of snapshotAt(r, t).pou) expect(v, `${name} ${k}`).toBeGreaterThanOrEqual(0)
    }
  }, 60000)

  it('never holds negative stock', () => {
    for (const t of times(97)) {
      const s = snapshotAt(result, t)
      for (const [k, v] of s.kanban) expect(v, k).toBeGreaterThanOrEqual(0)
      for (const [k, v] of s.pou) expect(v, k).toBeGreaterThanOrEqual(0)
    }
  })

  it('consumes the BOM quantity per rack (pieces fitted plus owed match racks through each station)', () => {
    const end = snapshotAt(result, result.horizon)
    const station = (id: string) => LAYOUT.stations.find((x) => x.id === id)!
    let expected = 0
    for (const e of result.inventory) {
      // Parts are fitted when the rack arrives, one conveyor transfer after the index.
      if (e.kind !== 'rack' || e.t + result.transferS > result.horizon) continue
      // Sub-assembly works in step with blades / cassettes, so it builds for the rack there.
      const visits = e.station === SUBASSY_FEEDS ? [station(SUBASSY_FEEDS), station('SUBASSY')] : [station(e.station)]
      for (const v of visits) for (const p of v.pou) {
        const part = getPart(p.pn)
        if (isTracked(part) && part.models.includes(e.model)) expected += part.qtyPerRack!
      }
    }
    const owed = [...end.backorder.values()].reduce((a, b) => a + b, 0)
    expect(expected).toBeGreaterThan(0)
    expect(end.consumed + owed).toBe(expected)
  })

  it('moves every card round the loop in order (Kanban state machine)', () => {
    const next: Record<string, string[]> = {
      FULL: ['IN_USE'], IN_USE: ['EMPTY'], EMPTY: ['REQUESTED'], REQUESTED: ['PREPARING'],
      PREPARING: ['IN_TRANSIT'], IN_TRANSIT: ['REPLENISHED'], REPLENISHED: ['FULL', 'IN_USE'],
    }
    const last = new Map<string, string>()
    for (const e of result.inventory) {
      if (e.kind !== 'kstate') continue
      const prev = last.get(e.slotId)
      if (prev) expect(next[prev], `${e.slotId} ${prev} -> ${e.state} at ${e.t}`).toContain(e.state)
      last.set(e.slotId, e.state)
    }
    expect(result.cycles.length).toBeGreaterThan(5)
  })

  it('collects cards only at board inspections', () => {
    for (const c of result.cycles) {
      if (c.requestedAt === undefined) continue
      expect(result.inspections, `${c.slotId}`).toContain(c.requestedAt)
      expect(c.requestedAt - c.emptyAt).toBeLessThanOrEqual(DEFAULT_MOVEMENT.inspectionIntervalMin * 60)
      if (c.prepStartAt !== undefined) expect(c.prepStartAt).toBeGreaterThanOrEqual(c.requestedAt)
      if (c.replenishedAt !== undefined) expect(c.late).toBe(c.replenishedAt > c.dueAt)
    }
    const gaps = result.inspections.slice(1).map((t, i) => t - result.inspections[i])
    for (const g of gaps) expect(g).toBe(DEFAULT_MOVEMENT.inspectionIntervalMin * 60)
  })

  it('a Kanban is never picked while it is being replenished', () => {
    const state = new Map<string, string>()
    for (const e of result.inventory) {
      if (e.kind === 'kstate') state.set(e.slotId, e.state)
      if (e.kind === 'kanban' && e.delta === -1) expect(['FULL', 'IN_USE', 'REPLENISHED'], `${e.slotId} at ${e.t}`).toContain(state.get(e.slotId))
    }
  })

  it('in pass mode, logs starvation intervals that close when stock arrives and never stops the line', () => {
    const pass = run('pass8')
    expect(pass.starvations.length).toBeGreaterThan(0)
    for (const s of pass.starvations) {
      expect(s.racks).toBeGreaterThan(0)
      if (s.to !== undefined) expect(s.to).toBeGreaterThan(s.from)
    }
    expect(pass.blocks).toHaveLength(0)
    expect(pass.stats.racksCompleted).toBe(pass.targetRacks)
    // Fewer handlers and a faster line must not reduce starvation.
    const slow = runMovementSim({ ...DEFAULT_MOVEMENT, shortage: 'pass', clsHandlers: 1, ratePerHour: 7, shiftH: 4 })
    const base = runMovementSim({ ...DEFAULT_MOVEMENT, shortage: 'pass', shiftH: 4 })
    expect(slow.stats.starvationEvents).toBeGreaterThan(base.stats.starvationEvents)
  })

  it('a material shortage blocks production (acceptance 5)', () => {
    const r = run('noTShelf')
    expect(r.blocks.length).toBeGreaterThan(0)
    expect(r.blocks[0].from).toBe(0)
    expect(r.blocks[0].keys).toContain('ST2:1181838-03')
    expect(r.stats.blockedSec).toBeGreaterThan(3600)
    expect(r.stats.racksCompleted).toBeLessThan(r.targetRacks)
    // Blocking never lets a rack pass short.
    expect(r.starvations).toHaveLength(0)
  })

  it('the stopped line does not index, and restarts when the missing pallet arrives', () => {
    for (const name of ['rate8', 'noTShelf', 'lean'] as const) {
      const r = run(name)
      const racks = r.inventory.filter((e) => e.kind === 'rack').map((e) => e.t)
      const deliveries = new Set(r.tasks.filter((x) => x.kind === 'pou-delivery').map((x) => x.deliveredAt))
      for (const b of r.blocks) {
        expect(racks.some((t) => t > b.from && t < (b.to ?? r.horizon)), `${name} rack during stop at ${b.from}`).toBe(false)
        if (b.to === undefined) continue
        expect(racks, `${name} restart at ${b.to}`).toContain(b.to)
        expect(deliveries.has(b.to), `${name} restart is a delivery`).toBe(true)
      }
      const blocked = r.blocks.reduce((a, b) => a + (b.to ?? r.horizon) - b.from, 0)
      expect(r.stats.blockedSec).toBeCloseTo(blocked, 6)
    }
  })

  it('increasing demand lowers inventory coverage when nothing else changes (acceptance 6)', () => {
    const base = computeKpis(result)
    const busy = computeKpis(run('rate8'))
    // Same stock, faster consumption: every part starts with fewer hours of cover...
    const start = new Map(base.coverage.map((c) => [c.pn, c.startH]))
    for (const c of busy.coverage) expect(c.startH, c.pn).toBeLessThan(start.get(c.pn)!)
    // ...and the lowest cover reached over the shift is lower on average. (Per part the low point
    // depends on when refills land, so it is not strictly monotonic.)
    const avgMin = (k: typeof base) => k.coverage.reduce((a, c) => a + c.minH, 0) / k.coverage.length
    expect(avgMin(busy)).toBeLessThan(avgMin(base))
    expect(busy.racksCompleted).toBeGreaterThan(base.racksCompleted)
    expect(busy.attainment).toBeLessThan(1)
  })

  it('a third Kanban skips DSV prep and reduces stoppage', () => {
    const r = run('thirdKanban')
    expect(r.reservePieces).toBe(22 * 16 + 11 * 8)
    const extra = new Set(SCENARIOS.thirdKanban.extraKanbanPns)
    const fast = r.cycles.filter((c) => extra.has(c.pn) && c.requestedAt !== undefined && c.prepStartAt === c.requestedAt)
    expect(fast.length).toBeGreaterThan(0)
    expect(r.stats.blockedSec).toBeLessThan(run('rate8').stats.blockedSec)
  })

  it('reduced starting stock starts Kanbans empty with their card already on the board', () => {
    const r = run('noTShelf')
    expect(r.initialKanban['1181838-03#0']).toBe(0)
    expect(r.initialKanban['1181838-03#1']).toBe(0)
    const first = r.cycles.find((c) => c.slotId === '1181838-03#0')!
    expect(first.emptyAt).toBe(0)
    expect(first.requestedAt).toBe(r.inspections[0])
    const half = runMovementSim({ ...DEFAULT_MOVEMENT, shiftH: 1, stock: { '1219362-02': { kanban: 0.5 } } })
    expect(half.initialKanban['1219362-02#0']).toBe(0)
    expect(half.initialKanban['1219362-02#1']).toBe(11)
  })

  it('keeps the random stream common across scenarios (same rack models whatever the stock)', () => {
    const models = (r: MovementResult) => r.inventory.filter((e) => e.kind === 'rack' && e.station === 'ST1').slice(0, 30).map((e) => (e as { model: string }).model)
    expect(models(run('noTShelf'))).toEqual(models(result))
  })

  it('rejects staffing the bays cannot hold', () => {
    expect(() => runMovementSim({ ...DEFAULT_MOVEMENT, clsHandlers: 9 })).toThrow()
    expect(() => runMovementSim({ ...DEFAULT_MOVEMENT, dsvHandlers: 0 })).toThrow()
  })

  it('carries material only between a pick and a drop', () => {
    for (const task of result.tasks) {
      const h = result.handlers.find((x) => x.id === task.handler)!
      expect(poseAt(h, task.pickAt - 0.5).load).toBeNull()
      expect(poseAt(h, (task.pickAt + task.deliveredAt) / 2).load?.pn).toBe(task.pn)
      expect(poseAt(h, task.deliveredAt + 0.01).load).toBeNull()
    }
  })

  it('delivers to the right place and then parks', () => {
    for (const task of result.tasks) {
      const h = result.handlers.find((x) => x.id === task.handler)!
      const p = poseAt(h, task.deliveredAt)
      const d = GRAPH.dwells.get(task.to)!
      expect(Math.hypot(p.x - d.pos.x, p.z - d.pos.z), task.id).toBeLessThan(1e-6)
      const home = GRAPH.dwells.get(h.home)!
      const parked = poseAt(h, task.doneAt)
      expect(Math.hypot(parked.x - home.pos.x, parked.z - home.pos.z), `${task.id} parked`).toBeLessThan(1e-6)
    }
  })

  it('poses depend only on simulation time, not on playback history (acceptance 7, 8)', () => {
    // Pausing samples the same time repeatedly; 1x and 10x reach a time through different call
    // sequences. None of that may change the pose: there is no hidden animation state.
    const T = 4321.5
    const direct = result.handlers.map((h) => poseAt(h, T))
    for (const h of result.handlers) {
      for (let t = 0; t < T; t += 1 / 60) poseAt(h, t)      // 1x at 60 fps
      for (let t = 0; t < T; t += 10 / 60) poseAt(h, t)     // 10x
      for (let i = 0; i < 100; i++) poseAt(h, T)            // paused
    }
    expect(result.handlers.map((h) => poseAt(h, T))).toEqual(direct)
  })

  it('raising demand raises handler workload', () => {
    const busy = runMovementSim({ ...DEFAULT_MOVEMENT, ratePerHour: 8 })
    expect(busy.stats.deliveries).toBeGreaterThan(result.stats.deliveries)
  })
})
