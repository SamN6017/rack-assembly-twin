import { getPart, KANBAN_PARTS } from '../data/parts'
import { LAYOUT } from '../layout/factoryLayout'
import { applyEvent, initialSnapshot, rackId, isTracked, partRate, poseAt, type InventorySnapshot, type MovementResult, targetBy } from './movementSim'

/** Hours of consumption one part's floor stock (both Kanbans plus every POU) covers. */
export function coverageHours(s: InventorySnapshot, result: MovementResult, pn: string): number | null {
  const part = getPart(pn)
  if (!isTracked(part)) return null
  const rate = partRate(part, result.config) * part.qtyPerRack!
  if (rate <= 0) return null
  let pieces = 0
  for (const slot of LAYOUT.slots) if (slot.pn === pn) pieces += (s.kanban.get(slot.id) ?? 0) * part.qtyPerPallet!
  for (const [key, v] of s.pou) if (key.endsWith(`:${pn}`)) pieces += v
  return pieces / rate
}

export interface PartConstraint {
  pn: string
  /** Seconds the line stood waiting for this part (stops can wait for several parts at once). */
  blockedSec: number
  stops: number
  firstAt: number
}

export interface PartCoverage { pn: string; startH: number; minH: number; minAt: number; endH: number }

export interface Kpis {
  horizonH: number
  targetRacks: number
  racksCompleted: number
  attainment: number
  /** Racks per hour the material flow allowed (no station cycle times, so not verified throughput). */
  feasibleRate: number
  blockEvents: number
  blockedH: number
  starvationEvents: number
  cardsReplenished: number
  lateCards: number
  avgReplenishMin: number | null
  maxReplenishMin: number | null
  /** Kanbans out on the replenishment loop: peak and time-weighted mean. */
  loopPeak: number
  loopMean: number
  deliveries: number
  refillTrips: number
  /** POU request to handler dispatch, and request to delivery, minutes. */
  clsQueueMin: number
  clsDeliveryMin: number
  clsDeliveryMaxMin: number
  utilCls: number
  utilDsv: number
  /** Floor stock at t = 0 and third-Kanban reserve, pieces of tracked parts. */
  startPieces: number
  reservePieces: number
  constrained: PartConstraint[]
  coverage: PartCoverage[]
  series: SeriesPoint[]
}

/** One sample of the shift, for time-series charts. Pieces are tracked parts only. */
export interface SeriesPoint {
  t: number
  /** Hours since shift start (chart x). */
  h: number
  racks: number
  /** Racks the line would have finished by now without stops. */
  target: number
  /** Minutes the line has stood so far. */
  lostMin: number
  stopped: 0 | 1
  /** Kanbans with no pallets, and cards out on the replenishment loop. */
  emptyKanbans: number
  loop: number
  kanbanPcs: number
  pouPcs: number
  /** Staged at DSV or on a handler's forks. */
  transitPcs: number
  busyCls: number
  busyDsv: number
}

export const SERIES_STEP = 300

/** Shift sampled every SERIES_STEP seconds (plus the horizon). */
export function computeSeries(result: MovementResult, step = SERIES_STEP): SeriesPoint[] {
  const H = result.horizon
  const out: SeriesPoint[] = []
  const s = initialSnapshot(result)
  const onLoop = new Set(['EMPTY', 'REQUESTED', 'PREPARING', 'IN_TRANSIT'])
  const qpp = (pn: string) => getPart(pn).qtyPerPallet ?? 0
  const trackedSlot = new Map(LAYOUT.slots.map((sl) => [sl.id, isTracked(getPart(sl.pn)) ? getPart(sl.pn).qtyPerPallet! : 0]))
  const roleOf = new Map(result.handlers.map((h) => [h.id, h.role]))
  let i = 0
  const times: number[] = []
  for (let t = 0; t < H; t += step) times.push(t)
  times.push(H)
  for (const t of times) {
    while (i < result.inventory.length && result.inventory[i].t <= t) applyEvent(s, result.inventory[i++])
    let kanbanPcs = 0, emptyKanbans = 0, loop = 0
    for (const [id, n] of s.kanban) { kanbanPcs += n * trackedSlot.get(id)!; if (n === 0) emptyKanbans++ }
    for (const c of s.cards.values()) if (onLoop.has(c.state)) loop++
    let transitPcs = s.stage.reduce((a, pn) => a + (pn && isTracked(getPart(pn)) ? qpp(pn) : 0), 0)
    for (const h of result.handlers) { const l = poseAt(h, t).load; if (l && isTracked(getPart(l.pn))) transitPcs += qpp(l.pn) }
    let busyCls = 0, busyDsv = 0
    for (const x of result.tasks) if (x.dispatchedAt <= t && x.doneAt > t) { if (roleOf.get(x.handler) === 'CLS') busyCls++; else busyDsv++ }
    const lost = result.blocks.reduce((a, b) => a + Math.max(0, Math.min(b.to ?? H, t) - b.from), 0)
    out.push({
      t, h: t / 3600, racks: s.racksCompleted, target: targetBy(result, t),
      lostMin: lost / 60, stopped: s.line.blocked ? 1 : 0, emptyKanbans, loop, kanbanPcs,
      pouPcs: [...s.pou.values()].reduce((a, b) => a + b, 0), transitPcs, busyCls, busyDsv,
    })
  }
  return out
}

export type LogType =
  | 'PRODUCTION_REQUESTED' | 'MATERIAL_ALLOCATED' | 'KANBAN_EMPTY' | 'REPLENISHMENT_REQUESTED' | 'REPLENISHMENT_PREPARED'
  | 'HANDLER_DISPATCHED' | 'HANDLER_ARRIVED' | 'MATERIAL_DELIVERED' | 'MATERIAL_CONSUMED' | 'PRODUCTION_BLOCKED'
  | 'PRODUCTION_RESUMED' | 'RACK_COMPLETED' | 'KANBAN_REPLENISHED' | 'BOARD_INSPECTION'

export interface LogEvent { t: number; type: LogType; text: string; entity?: string }

const logCache = new WeakMap<MovementResult, LogEvent[]>()

/**
 * The simulation event log in the brief's vocabulary, derived from the run. Allocation is the
 * moment a Kanban pallet is reserved for a POU task (dispatch); consumption is logged per station
 * and rack.
 */
export function eventLog(result: MovementResult): LogEvent[] {
  const cached = logCache.get(result)
  if (cached) return cached
  const out: LogEvent[] = []
  const desc = (pn: string | null) => (pn ? getPart(pn).description : 'pallet')
  const lineIds = LAYOUT.stations.filter((x) => x.id !== 'SUBASSY').map((x) => x.id)
  for (const e of result.inventory) {
    if (e.kind === 'rack') {
      if (e.station === lineIds[0]) out.push({ t: e.t, type: 'PRODUCTION_REQUESTED', text: `${rackId(e.rack)} (${e.model}) loaded at ${e.station}`, entity: `linerack:${e.rack}` })
    } else if (e.kind === 'complete') {
      out.push({ t: e.t, type: 'RACK_COMPLETED', text: `${rackId(e.rack)} (${e.model}) completed at ${lineIds[lineIds.length - 1]}`, entity: `linerack:${e.rack}` })
    } else if (e.kind === 'pou' && e.consumed > 0) {
      const [st, pn] = e.key.split(':')
      out.push({ t: e.t, type: 'MATERIAL_CONSUMED', text: `${st} fitted ${e.consumed} × ${desc(pn)} (${e.pieces} left)`, entity: `pou:${st}:${pn}` })
    } else if (e.kind === 'kstate') {
      const [pn, k] = e.slotId.split('#')
      const label = `${desc(pn)} Kanban #${Number(k) + 1}`
      if (e.state === 'EMPTY' && e.t > 0) out.push({ t: e.t, type: 'KANBAN_EMPTY', text: `${label} empty, card on the board`, entity: `kanban:${e.slotId}:0` })
      if (e.state === 'REQUESTED') out.push({ t: e.t, type: 'REPLENISHMENT_REQUESTED', text: `DSV collected the card for ${label}`, entity: `kanban:${e.slotId}:0` })
      if (e.state === 'REPLENISHED') out.push({ t: e.t, type: 'KANBAN_REPLENISHED', text: `${label} refilled`, entity: `kanban:${e.slotId}:0` })
    } else if (e.kind === 'line') {
      if (e.blocked && !out.some((x, i) => i === out.length - 1 && x.type === 'PRODUCTION_BLOCKED' && x.t === e.t))
        out.push({ t: e.t, type: 'PRODUCTION_BLOCKED', text: `Line stopped: waiting for ${e.keys.map((k) => `${desc(k.split(':')[1])} @ ${k.split(':')[0]}`).join(', ')}`, entity: e.keys[0] ? `pou:${e.keys[0]}` : undefined })
      if (!e.blocked) out.push({ t: e.t, type: 'PRODUCTION_RESUMED', text: 'Line restarted' })
    } else if (e.kind === 'inspect') {
      out.push({ t: e.t, type: 'BOARD_INSPECTION', text: 'DSV inspects the Kanban board' })
    }
  }
  for (const c of result.cycles) if (c.stagedAt !== undefined) out.push({ t: c.stagedAt, type: 'REPLENISHMENT_PREPARED', text: `Pallets for ${desc(c.pn)} Kanban #${Number(c.slotId.split('#')[1]) + 1} prepared and staged`, entity: `kanban:${c.slotId}:0` })
  for (const x of result.tasks) {
    const h = `handler:${x.handler}`
    const what = x.kind === 'pou-delivery' ? `${desc(x.pn)} to POU` : `${desc(x.pn)} to Kanban`
    if (x.kind === 'pou-delivery') out.push({ t: x.dispatchedAt, type: 'MATERIAL_ALLOCATED', text: `${x.id}: Kanban pallet of ${desc(x.pn)} reserved`, entity: h })
    out.push({ t: x.dispatchedAt, type: 'HANDLER_DISPATCHED', text: `${x.handler} dispatched: ${what} (${x.id})`, entity: h })
    out.push({ t: x.pickAt, type: 'HANDLER_ARRIVED', text: `${x.handler} at pick-up, loading ${desc(x.pn)}`, entity: h })
    out.push({ t: x.deliveredAt, type: 'MATERIAL_DELIVERED', text: `${x.handler} delivered ${what}`, entity: h })
  }
  out.sort((a, b) => a.t - b.t)
  logCache.set(result, out)
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function computeKpis(result: MovementResult): Kpis {
  const H = result.horizon
  const closed = result.cycles.filter((c) => c.replenishedAt !== undefined)
  const leads = closed.map((c) => (c.replenishedAt! - c.emptyAt) / 60)

  // Walk the inventory once: cards on the loop over time, and part coverage sampled every 15 min.
  const onLoop = new Set(['EMPTY', 'REQUESTED', 'PREPARING', 'IN_TRANSIT'])
  const state = new Map<string, string>()
  let loopN = 0, loopPeak = 0, loopArea = 0, lastT = 0
  const s = initialSnapshot(result)
  const tracked = KANBAN_PARTS.filter(isTracked)
  const cov = new Map<string, PartCoverage>()
  const sample = (t: number) => {
    for (const p of tracked) {
      const h = coverageHours(s, result, p.pn)
      if (h === null) continue
      const c = cov.get(p.pn)
      if (!c) cov.set(p.pn, { pn: p.pn, startH: h, minH: h, minAt: t, endH: h })
      else { if (h < c.minH) { c.minH = h; c.minAt = t } c.endH = h }
    }
  }
  const STEP = 900
  let nextSample = 0
  for (const e of result.inventory) {
    while (e.t > nextSample && nextSample <= H) { sample(nextSample); nextSample += STEP }
    if (e.kind === 'kstate') {
      loopArea += loopN * (e.t - lastT)
      lastT = e.t
      const was = onLoop.has(state.get(e.slotId) ?? '')
      const now = onLoop.has(e.state)
      state.set(e.slotId, e.state)
      loopN += (now ? 1 : 0) - (was ? 1 : 0)
      loopPeak = Math.max(loopPeak, loopN)
    }
    applyEvent(s, e)
  }
  while (nextSample <= H) { sample(nextSample); nextSample += STEP }
  loopArea += loopN * (H - lastT)

  const byPn = new Map<string, PartConstraint>()
  for (const b of result.blocks) {
    const dur = (b.to ?? H) - b.from
    for (const pn of new Set(b.keys.map((k) => k.split(':')[1]))) {
      const c = byPn.get(pn) ?? { pn, blockedSec: 0, stops: 0, firstAt: b.from }
      c.blockedSec += dur
      c.stops++
      byPn.set(pn, c)
    }
  }
  for (const st of result.starvations) {
    const c = byPn.get(st.pn) ?? { pn: st.pn, blockedSec: 0, stops: 0, firstAt: st.from }
    c.stops++
    c.firstAt = Math.min(c.firstAt, st.from)
    byPn.set(st.pn, c)
  }

  const pou = result.tasks.filter((x) => x.kind === 'pou-delivery')
  const busy = (role: 'CLS' | 'DSV') => {
    const ids = new Set(result.handlers.filter((h) => h.role === role).map((h) => h.id))
    const sec = result.tasks.filter((x) => ids.has(x.handler)).reduce((a, x) => a + Math.min(x.doneAt, H) - Math.min(x.dispatchedAt, H), 0)
    return ids.size ? sec / (ids.size * H) : 0
  }

  return {
    horizonH: H / 3600,
    targetRacks: result.targetRacks,
    racksCompleted: result.stats.racksCompleted,
    attainment: result.stats.racksCompleted / result.targetRacks,
    feasibleRate: result.stats.racksCompleted / (H / 3600),
    blockEvents: result.stats.blockEvents,
    blockedH: result.stats.blockedSec / 3600,
    starvationEvents: result.stats.starvationEvents,
    cardsReplenished: result.stats.cardsReplenished,
    lateCards: result.stats.lateCards,
    avgReplenishMin: leads.length ? mean(leads) : null,
    maxReplenishMin: leads.length ? Math.max(...leads) : null,
    loopPeak,
    loopMean: loopArea / H,
    deliveries: result.stats.deliveries,
    refillTrips: result.stats.refillTrips,
    clsQueueMin: mean(pou.map((x) => (x.dispatchedAt - x.requestedAt) / 60)),
    clsDeliveryMin: mean(pou.map((x) => (x.deliveredAt - x.requestedAt) / 60)),
    clsDeliveryMaxMin: pou.length ? Math.max(...pou.map((x) => (x.deliveredAt - x.requestedAt) / 60)) : 0,
    utilCls: busy('CLS'),
    utilDsv: busy('DSV'),
    startPieces: result.initialPieces,
    reservePieces: result.reservePieces,
    constrained: [...byPn.values()].sort((a, b) => b.blockedSec - a.blockedSec || a.firstAt - b.firstAt),
    coverage: [...cov.values()].sort((a, b) => a.minH - b.minH),
    series: computeSeries(result),
  }
}
