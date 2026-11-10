import { getPart, KANBAN_PARTS, PART_BY_PN, type KanbanPart, type Model } from '../data/parts'
import { LAYOUT } from '../layout/factoryLayout'
import { EventQueue, seededRandom } from './eventQueue'
import { buildPath, makeProfile, type Vec2 } from './path'
import { GRAPH, kanbanDwellId, parkDwellId, pouDwellId, routeBetween, stageDwellId, type Dwell } from './routeGraph'
import {
  capsuleGap, capsuleOf, poseInSeg, sampleSegs, yawOf, angleDelta,
  type CarriedLoad, type DwellSeg, type Phase, type Pose, type TimelineSeg,
} from './timeline'

/**
 * Material-flow simulation: line consumption, Kanban cards and pallet movement.
 *
 * The line pulls one rack per takt. Each rack is a Yawn or a Bloom (seeded by the model mix) and
 * consumes its BOM quantity of every pallet part at the line station that fits it. A point-of-use pallet
 * that can no longer supply a full rack raises a delivery task that a CLS handler fulfils from the
 * part's in-use Kanban. When a Kanban's last pallet leaves, its card goes on the board; DSV collects
 * cards at each board inspection, prepares the pallets, stages them and a DSV handler refills the
 * Kanban. Stock is tracked in pieces; pallets move whole.
 *
 * The line is paced: every takt all stations index together, each fitting parts to the rack in
 * front of it. With shortage 'block' the line does not index while any station lacks the pieces
 * for its rack; it restarts the moment the missing pallet is delivered (PRODUCTION_BLOCKED). With
 * 'pass' a short rack moves on and the pieces are owed (logged as a starvation).
 * Each index starts a physical transfer: every rack rides the conveyor to the next station
 * together (walking-beam style). Stations differ in length, so `transferS` is the time for the
 * longest move at the conveyor's placeholder speed. Each station then assembles for the rest of the
 * takt; material leaves POU stock when the rack arrives (assembly start), and a rack is complete
 * when packout's work ends, one takt after it entered the last station.
 * Station cycle times are unknown, so the takt stands in for them: output is material-feasible
 * production, not verified factory throughput.
 * Everything is computed up front, so handler poses and stock are pure functions of time.
 */

export interface MovementConfig {
  seed: number
  /** Hours per shift, and shifts simulated back to back (breaks are not modelled). */
  shiftH: number
  shifts: number
  /** Racks per hour driving consumption. Baseline 5 (slide P1). */
  ratePerHour: number
  /** 'block' stops the paced line until a missing part arrives; 'pass' lets a short rack move on. */
  shortage: 'block' | 'pass'
  /** Share of racks that are Bloom. PLACEHOLDER: the model mix is not in the sources. */
  bloomShare: number
  clsHandlers: number
  dsvHandlers: number
  /** m/s and m/s². ESTIMATES for a walked pallet jack. */
  vEmpty: number
  vLoaded: number
  vSpur: number
  accel: number
  /** Seconds to slide forks in and lift / lower and withdraw. ESTIMATES. */
  loadS: number
  unloadS: number
  turnRateDeg: number
  /** DSV checks the Kanban board every 1–2 h (VERIFIED, slide P1). */
  inspectionIntervalMin: number
  /** DSV time to prepare one Kanban's pallets. PLACEHOLDER (only the 2 h total lead time is known). */
  dsvPrepMin: number
  /** Kanbans DSV can prepare at once. PLACEHOLDER. */
  dsvPrepTeams: number
  /** Card empty to Kanban refilled (VERIFIED, 2 h). A refill after this is a late delivery. */
  leadTimeH: number
  /** POU calls a pallet when it covers fewer racks than this. ESTIMATE (slides: 1 pallet at POU). */
  pouReorderRacks: number
  /** CLS task order: first come first served, or deliveries that would stop the line first. */
  clsPriority: 'fifo' | 'line-stop-first'
  /** Parts with a third Kanban, held prepared at DSV so a collected card skips prep (Experiment B). */
  extraKanbanPns: string[]
  /** Starting stock as a share of full, per part: both Kanbans together, and the POU pallet. */
  stock: Record<string, { kanban?: number; pou?: number }>
  /** Rack conveyor between stations, m/s and m/s². PLACEHOLDERS: no line equipment data. */
  conveyorSpeed: number
  conveyorAccel: number
  /** Outfeed conveyor from packout to finished-rack staging, m/s. PLACEHOLDER. */
  outfeedSpeed: number
}

export const DEFAULT_MOVEMENT: MovementConfig = {
  seed: 7, shiftH: 10, shifts: 1, ratePerHour: 5, bloomShare: 0.5, shortage: 'block',
  clsHandlers: 2, dsvHandlers: 1,
  vEmpty: 1.3, vLoaded: 1.0, vSpur: 0.5, accel: 0.5,
  loadS: 20, unloadS: 20, turnRateDeg: 90,
  inspectionIntervalMin: 60, dsvPrepMin: 45, dsvPrepTeams: 2, leadTimeH: 2,
  pouReorderRacks: 1, clsPriority: 'fifo', extraKanbanPns: [], stock: {},
  conveyorSpeed: 0.4, conveyorAccel: 0.2, outfeedSpeed: 0.4,
}

/** Distance of each conveyor move into station k: the load position to station 1, then stop to stop. */
export const STOP_DISTANCES = LAYOUT.conveyor.stops.map((p, k) => {
  const from = k === 0 ? LAYOUT.conveyor.load : LAYOUT.conveyor.stops[k - 1]
  return Math.hypot(p.x - from.x, p.z - from.z)
})

/** Seconds an index takes: every rack moves at once, so the longest move sets the time. */
export const transferSeconds = (cfg: MovementConfig) => makeProfile(Math.max(...STOP_DISTANCES), cfg.conveyorSpeed, cfg.conveyorAccel).duration

/** Handler bays in the layout cap the staffing levels a scenario can use. */
export const MAX_HANDLERS = {
  CLS: LAYOUT.parkingSpots.filter((p) => p.role === 'CLS').length,
  DSV: LAYOUT.parkingSpots.filter((p) => p.role === 'DSV').length,
}

export type KanbanState = 'FULL' | 'IN_USE' | 'EMPTY' | 'REQUESTED' | 'PREPARING' | 'IN_TRANSIT' | 'REPLENISHED'
export const KANBAN_STATES: KanbanState[] = ['FULL', 'IN_USE', 'EMPTY', 'REQUESTED', 'PREPARING', 'IN_TRANSIT', 'REPLENISHED']

export type { Model }

export type InvEvent =
  | { t: number; kind: 'kanban'; slotId: string; delta: 1 | -1 }
  /** POU stock after the event, and pieces consumed by it. */
  | { t: number; kind: 'pou'; key: string; pieces: number; consumed: number }
  | { t: number; kind: 'stage'; slot: number; pn: string | null }
  | { t: number; kind: 'kstate'; slotId: string; state: KanbanState }
  /** Pieces owed to racks that passed this POU short. 0 ends the starvation. */
  | { t: number; kind: 'starve'; key: string; backorder: number }
  | { t: number; kind: 'rack'; station: string; rack: number; model: Model; last: boolean }
  | { t: number; kind: 'inspect' }
  /** Packout finished this rack: a completed rack (RACK_COMPLETED). */
  | { t: number; kind: 'complete'; rack: number; model: Model }
  /** The paced line stopped (keys: POUs it waits for) or restarted. */
  | { t: number; kind: 'line'; blocked: boolean; keys: string[] }

export interface TaskRecord {
  id: string
  kind: 'pou-delivery' | 'kanban-refill'
  handler: string
  pn: string | null
  from: string
  to: string
  requestedAt: number
  dispatchedAt: number
  departAt: number
  pickAt: number
  deliveredAt: number
  /** Back in the parking bay. */
  doneAt: number
}

/** One trip of a Kanban card round the loop, from empty to refilled. Times past the horizon are absent. */
export interface CardCycle {
  slotId: string
  pn: string
  emptyAt: number
  dueAt: number
  requestedAt?: number
  prepStartAt?: number
  stagedAt?: number
  inTransitAt?: number
  replenishedAt?: number
  late?: boolean
}

export interface Starvation {
  key: string
  station: string
  pn: string
  from: number
  /** Absent while still starved at the horizon. */
  to?: number
  racks: number
  pieces: number
}

/** One stop of the paced line for missing material. */
export interface LineBlock {
  from: number
  /** Absent while still stopped at the horizon. */
  to?: number
  /** Line index that could not start. */
  index: number
  /** Every POU (station:pn) the line waited for during the stop. */
  keys: string[]
}

export interface HandlerTimeline {
  id: string
  role: 'CLS' | 'DSV'
  home: string
  segs: TimelineSeg[]
}

export interface MovementResult {
  config: MovementConfig
  horizon: number
  takt: number
  handlers: HandlerTimeline[]
  inventory: InvEvent[]
  tasks: TaskRecord[]
  cycles: CardCycle[]
  starvations: Starvation[]
  blocks: LineBlock[]
  inspections: number[]
  /** Pieces of tracked parts at t = 0 (Kanbans plus POU). */
  initialPieces: number
  /** Pallets on each Kanban slot at t = 0. */
  initialKanban: Record<string, number>
  /** Racks the line would finish in the horizon if it never stopped. */
  targetRacks: number
  /** Start time of each line index j (all racks begin their transfer). */
  indexTimes: number[]
  /** Conveyor transfer between stations, and the assembly window left in each takt (s). */
  transferS: number
  assemblyS: number
  /** Rack number of the first rack on the line at t = 0, and every rack's model from there on. */
  firstRack: number
  rackModels: Model[]
  /** Pieces held in third Kanbans at DSV (outside the floor stock, Experiment B). */
  reservePieces: number
  stats: {
    unresolvedConflicts: number; deliveries: number; refillTrips: number
    racksCompleted: number; starvationEvents: number; lateCards: number; cardsReplenished: number
    blockEvents: number; blockedSec: number
  }
  /** Plans that could not avoid another handler within MAX_DELAY (should be empty). */
  conflicts: { handler: string; task: string; at: number; with: string; x: number; z: number }[]
}

const CONFLICT_STEP = 0.4
const DELAY_STEP = 2
const MAX_DELAY = 1800
const SAFETY_GAP = 0.15

type Step =
  | { type: 'travel'; to: string; phase: Phase; load: CarriedLoad | null }
  | { type: 'dwell'; phase: Phase; dur: number; lift0: number; lift1: number; load: CarriedLoad | null }

interface HState {
  tl: HandlerTimeline
  at: string        // dwell id the handler is at (or will be at when free)
  freeAt: number
}

type Ev =
  | { type: 'index'; j: number }
  | { type: 'assemble'; j: number }
  | { type: 'complete'; rack: number }
  | { type: 'handlerFree'; h: number }
  | { type: 'inspect' }
  | { type: 'prepDone'; slotId: string }
  | { type: 'stageFreed'; slot: number }
  | { type: 'refilled'; slotId: string }
  | { type: 'pouDelivered'; station: string; pn: string }
  | { type: 'picked'; slotId: string; index: number }
  | { type: 'refillPicked'; slotId: string; pos: number }

/** Racks per hour that consume this part, given the model mix. */
export function partRate(part: KanbanPart, cfg: MovementConfig): number {
  const share = part.models.length > 1 ? 1 : part.models[0] === 'Bloom' ? cfg.bloomShare : 1 - cfg.bloomShare
  return cfg.ratePerHour * share
}

/** Hours one POU pallet lasts on average, or null when the BOM quantity is unknown. */
export function pouPalletHours(part: KanbanPart, cfg: MovementConfig): number | null {
  if (!part.qtyPerPallet || !part.qtyPerRack) return null
  const rate = partRate(part, cfg)
  return rate > 0 ? part.qtyPerPallet / (part.qtyPerRack * rate) : null
}

/** Parts whose stock can be simulated: both BOM quantity and pallet quantity are known. */
export const isTracked = (part: KanbanPart) => !!part.qtyPerPallet && !!part.qtyPerRack

/** Line station the sub-assembly builds for (blades / cassettes): it works in step with it. */
export const SUBASSY_FEEDS = 'ST2'

/** Order in which a rack visits the stations. */
export function stationStep(stationId: string): number {
  const line = LAYOUT.stations.filter((s) => s.id !== 'SUBASSY').map((s) => s.id)
  return line.indexOf(stationId === 'SUBASSY' ? SUBASSY_FEEDS : stationId)
}

export function runMovementSim(cfg: MovementConfig = DEFAULT_MOVEMENT): MovementResult {
  const horizon = cfg.shiftH * cfg.shifts * 3600
  const takt = 3600 / cfg.ratePerHour
  const transferS = transferSeconds(cfg)
  if (!(transferS < takt - 30)) throw new Error(`Conveyor transfer (${Math.round(transferS)} s) leaves no assembly time in a ${Math.round(takt)} s takt`)
  const indexTimes: number[] = []
  const rnd = seededRandom(cfg.seed)
  const q = new EventQueue<Ev>()
  const inventory: InvEvent[] = []
  const tasks: TaskRecord[] = []
  const cycles: CardCycle[] = []
  const starvations: Starvation[] = []
  const inspections: number[] = []
  const blocks: LineBlock[] = []
  const stats = { unresolvedConflicts: 0, deliveries: 0, refillTrips: 0, racksCompleted: 0, starvationEvents: 0, lateCards: 0, cardsReplenished: 0, blockEvents: 0, blockedSec: 0 }
  const turnRate = (cfg.turnRateDeg * Math.PI) / 180
  const routeCache = new Map<string, Vec2[]>()
  const route = (a: string, b: string) => {
    const k = `${a}>${b}`
    let r = routeCache.get(k)
    if (!r) { r = routeBetween(GRAPH, a, b); routeCache.set(k, r) }
    return r
  }
  const dwell = (id: string): Dwell => GRAPH.dwells.get(id)!
  const spurYaw = (d: Dwell) => yawOf(-d.into.x, -d.into.z)

  // ---- Handlers start parked in their role's bays ----
  const roles: ('CLS' | 'DSV')[] = [...Array(cfg.clsHandlers).fill('CLS'), ...Array(cfg.dsvHandlers).fill('DSV')]
  const bays = { CLS: [] as number[], DSV: [] as number[] }
  LAYOUT.parkingSpots.forEach((p, i) => bays[p.role].push(i))
  for (const r of ['CLS', 'DSV'] as const) {
    const n = roles.filter((x) => x === r).length
    if (n > bays[r].length) throw new Error(`At most ${bays[r].length} ${r} handlers fit the parking bays`)
    if (n < 1) throw new Error(`At least one ${r} handler is needed`)
  }
  const hs: HState[] = roles.map((role, i) => {
    const home = parkDwellId(bays[role].shift()!)
    const d = dwell(home)
    const yaw = spurYaw(d)
    const seg: DwellSeg = { kind: 'dwell', t0: 0, t1: 0, pos: d.pos, yaw0: yaw, yaw1: yaw, lift0: 0, lift1: 0, phase: 'idle', load: null, taskId: null }
    return { tl: { id: `H${i + 1}`, role, home, segs: [seg] }, at: home, freeAt: 0 }
  })

  // ---- Kanban state (pallets move whole) ----
  const slotsOf = (pn: string) => [0, 1].map((k) => LAYOUT.slots.find((s) => s.id === `${pn}#${k}`)!)
  const avail = new Map<string, number>()        // pallets present, not reserved, slot ready to pick from
  const ready = new Map<string, boolean>()       // false while a Kanban is being replenished
  const refillPos = new Map<string, number>()
  const inUse = new Map<string, number>()
  const card = new Map<string, KanbanState>()
  const openCycle = new Map<string, CardCycle>()
  let initialPieces = 0
  const initialKanban: Record<string, number> = {}
  const setCard = (t: number, slotId: string, state: KanbanState) => {
    card.set(slotId, state)
    inventory.push({ t, kind: 'kstate', slotId, state })
  }
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  /** Starting pallets on a Kanban. A reduced stock empties Kanban #1 (in use) first; #2 waits behind it. */
  const startPallets = (pn: string, index: number) => {
    const n = slotsOf(pn)[index].pallets.length
    const share = cfg.stock[pn]?.kanban
    if (share === undefined) return n
    const total = Math.round(clamp01(share) * 2 * n)
    const back = Math.min(n, total)
    return index === 1 ? back : total - back
  }
  for (const slot of LAYOUT.slots) {
    const a = startPallets(slot.pn, slot.index)
    const firstHasStock = startPallets(slot.pn, 0) > 0
    avail.set(slot.id, a)
    initialKanban[slot.id] = a
    const part = getPart(slot.pn)
    if (isTracked(part)) initialPieces += a * part.qtyPerPallet!
    if (a === 0) {
      // Starts empty: the card is already on the board and the Kanban waits for DSV.
      ready.set(slot.id, false)
      refillPos.set(slot.id, 0)
      setCard(0, slot.id, 'EMPTY')
      const c: CardCycle = { slotId: slot.id, pn: slot.pn, emptyAt: 0, dueAt: cfg.leadTimeH * 3600 }
      cycles.push(c)
      openCycle.set(slot.id, c)
    } else {
      ready.set(slot.id, true)
      setCard(0, slot.id, slot.index === 0 || !firstHasStock ? 'IN_USE' : 'FULL')
    }
  }
  for (const part of KANBAN_PARTS) inUse.set(part.pn, startPallets(part.pn, 0) > 0 ? 0 : 1)

  // Third Kanbans (Experiment B) wait prepared at DSV; using one queues its own re-preparation.
  const reserve = new Map<string, number>()
  let reservePieces = 0
  for (const pn of cfg.extraKanbanPns) {
    const part = PART_BY_PN.get(pn)
    if (!part || reserve.has(pn)) continue
    reserve.set(pn, 1)
    if (isTracked(part)) reservePieces += part.kanbanPallets * part.qtyPerPallet!
  }

  const stageOcc: (string | null)[] = LAYOUT.stagingSlots.map(() => null)
  const stageReserved: boolean[] = LAYOUT.stagingSlots.map(() => false)
  const pendingStage: { slotId: string; pn: string }[] = []
  const dsvTasks: { stage: number; slotId: string; pn: string; requestedAt: number }[] = []
  const clsTasks: { station: string; pn: string; requestedAt: number; short: boolean }[] = []
  /** Slot ids waiting for prep, or `reserve:<pn>` to re-prepare a third Kanban. */
  const prepQueue: string[] = []
  let prepBusy = 0

  // ---- Point-of-use stock (pieces) ----
  // Each POU starts with a partly used pallet (seeded) that still covers at least one rack.
  const pouPieces = new Map<string, number>()
  const backorder = new Map<string, number>()
  const requested = new Set<string>()
  const openStarve = new Map<string, Starvation>()
  for (const st of LAYOUT.stations) {
    for (const p of st.pou) {
      const part = getPart(p.pn)
      if (!isTracked(part)) continue
      const key = `${st.id}:${p.pn}`
      // Draw even when overridden, so every scenario sees the same random stream (common random numbers).
      const r = rnd()
      const share = cfg.stock[p.pn]?.pou
      const pieces = share === undefined
        ? Math.max(part.qtyPerRack!, Math.round(part.qtyPerPallet! * (0.15 + 0.85 * r)))
        : Math.round(part.qtyPerPallet! * clamp01(share))
      pouPieces.set(key, pieces)
      backorder.set(key, 0)
      initialPieces += pieces
      inventory.push({ t: 0, kind: 'pou', key, pieces, consumed: 0 })
    }
  }

  // The line is full at the start of the shift. At line index j, station step k works on rack j - k;
  // unblocked, index j starts at j * takt.
  const lineStations = LAYOUT.stations.filter((s) => s.id !== 'SUBASSY')
  const lastStep = lineStations.length - 1
  const firstRack = -lastStep
  const targetRacks = Math.floor(horizon / takt)
  const racksNeeded = targetRacks + lineStations.length + 1
  const models: Model[] = Array.from({ length: racksNeeded }, () => (rnd() < cfg.bloomShare ? 'Bloom' : 'Yawn'))
  const modelOf = (rack: number) => models[rack - firstRack]
  q.push(0, { type: 'index', j: 0 })
  for (let t = cfg.inspectionIntervalMin * 60; t <= horizon; t += cfg.inspectionIntervalMin * 60) q.push(t, { type: 'inspect' })

  // ---- Planning ----

  /** Build segments for a step list starting at `t0` from the handler's current pose. */
  function build(h: HState, t0: number, steps: Step[], taskId: string): TimelineSeg[] {
    const out: TimelineSeg[] = []
    let t = t0
    let at = h.at
    let pose = sampleSegs(h.tl.segs, t0)
    for (const s of steps) {
      if (s.type === 'dwell') {
        const d = dwell(at)
        out.push({ kind: 'dwell', t0: t, t1: t + s.dur, pos: d.pos, yaw0: pose.yaw, yaw1: pose.yaw, lift0: s.lift0, lift1: s.lift1, phase: s.phase, load: s.load, taskId })
        t += s.dur
        continue
      }
      const target = dwell(s.to)
      const v = s.load ? cfg.vLoaded : cfg.vEmpty
      const path = buildPath(route(at, s.to), 1.0)
      const prof = makeProfile(path.length, v, cfg.accel)
      if (path.length > 0) {
        const move: TimelineSeg = { kind: 'move', t0: t, t1: t + prof.duration, path, profile: prof, forksFirst: false, phase: s.phase, load: s.load, taskId }
        out.push(move)
        t = move.t1
        pose = poseInSeg(move, t)
      }
      // Turn on the spot so the forks face the storage position, then push in.
      const yawIn = spurYaw(target)
      const turn = Math.max(0.6, Math.abs(angleDelta(pose.yaw, yawIn)) / turnRate)
      out.push({ kind: 'dwell', t0: t, t1: t + turn, pos: target.junction, yaw0: pose.yaw, yaw1: yawIn, lift0: s.load ? 1 : 0, lift1: s.load ? 1 : 0, phase: 'turning', load: s.load, taskId })
      t += turn
      const spur = buildPath([target.junction, target.pos], 0)
      const sp = makeProfile(spur.length, cfg.vSpur, cfg.accel)
      const push: TimelineSeg = { kind: 'move', t0: t, t1: t + sp.duration, path: spur, profile: sp, forksFirst: true, phase: s.phase, load: s.load, taskId }
      out.push(push)
      t = push.t1
      pose = poseInSeg(push, t)
      at = s.to
    }
    return out
  }

  const conflicts: MovementResult['conflicts'] = []
  let lastHit: { t: number; with: string; x: number; z: number } | null = null

  /** First time in a window where this plan comes too close to another handler, or null. */
  function conflict(h: HState, segs: TimelineSeg[], from: number): number | null {
    const end = segs[segs.length - 1].t1
    const others = hs.filter((o) => o !== h)
    for (let t = from; t <= end + 1e-9; t += CONFLICT_STEP) {
      const mine = capsuleOf(sampleSegs(segs, t))
      for (const o of others) {
        const p = sampleSegs(o.tl.segs, t)
        if (Math.hypot(p.x - mine.a.x, p.z - mine.a.z) > 5) continue
        if (capsuleGap(mine, capsuleOf(p)) < SAFETY_GAP) { lastHit = { t, with: o.tl.id, x: p.x, z: p.z }; return t }
      }
    }
    return null
  }

  /**
   * Commit a plan, delaying departure (handler waits where it stands) until it no longer conflicts
   * with any committed movement. Handlers are planned in time order, so committed plans never move.
   */
  function commit(h: HState, now: number, steps: Step[], taskId: string) {
    let depart = Math.max(now, h.freeAt)
    let segs = build(h, depart, steps, taskId)
    while (conflict(h, segs, depart) !== null) {
      if (depart - now > MAX_DELAY) {
        stats.unresolvedConflicts++
        if (lastHit) conflicts.push({ handler: h.tl.id, task: taskId, at: lastHit.t, with: lastHit.with, x: lastHit.x, z: lastHit.z })
        break
      }
      depart += DELAY_STEP
      segs = build(h, depart, steps, taskId)
    }
    // Tasks always start empty-handed, so any hold before departure carries no load.
    const prev = h.tl.segs[h.tl.segs.length - 1]
    const start = Math.max(now, h.freeAt)
    if (prev.t1 < start) {
      const pose = sampleSegs(h.tl.segs, prev.t1)
      h.tl.segs.push({ kind: 'dwell', t0: prev.t1, t1: start, pos: { x: pose.x, z: pose.z }, yaw0: pose.yaw, yaw1: pose.yaw, lift0: 0, lift1: 0, phase: 'idle', load: null, taskId: null })
    }
    if (depart > start) {
      const pose = sampleSegs(h.tl.segs, start)
      h.tl.segs.push({ kind: 'dwell', t0: start, t1: depart, pos: { x: pose.x, z: pose.z }, yaw0: pose.yaw, yaw1: pose.yaw, lift0: 0, lift1: 0, phase: 'waiting', load: null, taskId })
    }
    h.tl.segs.push(...segs)
    return { depart, segs }
  }

  const startOf = (segs: TimelineSeg[], phase: Phase) => segs.find((s) => s.phase === phase)!

  function setFree(h: HState, at: string, t: number) {
    h.at = at
    h.freeAt = t
    q.push(t, { type: 'handlerFree', h: hs.indexOf(h) })
  }

  const idle = (role: 'CLS' | 'DSV', t: number) => hs.filter((h) => h.tl.role === role && h.freeAt <= t)

  function nearest(cands: HState[], to: string): HState {
    const p = dwell(to).pos
    return cands.reduce((best, h) => {
      const a = dwell(h.at).pos, b = dwell(best.at).pos
      return Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? h : best
    })
  }

  function dispatchCls(t: number) {
    if (cfg.clsPriority === 'line-stop-first') {
      // Stable sort: deliveries to a POU that cannot cover the next rack jump the queue.
      const urgent = (x: { station: string; pn: string }) => pouPieces.get(`${x.station}:${x.pn}`)! < getPart(x.pn).qtyPerRack! ? 0 : 1
      clsTasks.sort((a, b) => urgent(a) - urgent(b))
    }
    for (let i = 0; i < clsTasks.length; i++) {
      const free = idle('CLS', t)
      if (!free.length) return
      const task = clsTasks[i]
      const [s0, s1] = slotsOf(task.pn)
      let k = inUse.get(task.pn)!
      let slot = k === 0 ? s0 : s1
      if (!(ready.get(slot.id) && avail.get(slot.id)! > 0)) {
        const other = k === 0 ? s1 : s0
        if (ready.get(other.id) && avail.get(other.id)! > 0) {
          k = 1 - k
          inUse.set(task.pn, k)
          slot = other
        } else {
          task.short = true
          continue
        }
      }
      const index = avail.get(slot.id)! - 1
      avail.set(slot.id, index)
      if (index === 0) {
        // Last pallet reserved: nothing more can be picked until DSV has refilled this Kanban.
        ready.set(slot.id, false)
        refillPos.set(slot.id, 0)
      }
      const from = kanbanDwellId(slot.id, index)
      const to = pouDwellId(task.station, task.pn)
      const h = nearest(free, from)
      const id = `T${tasks.length + 1}`
      const load = { pn: task.pn }
      const { depart, segs } = commit(h, t, [
        { type: 'travel', to: from, phase: 'to-pick', load: null },
        { type: 'dwell', phase: 'loading', dur: cfg.loadS, lift0: 0, lift1: 1, load },
        { type: 'travel', to, phase: 'transporting', load },
        { type: 'dwell', phase: 'unloading', dur: cfg.unloadS, lift0: 1, lift1: 0, load },
        { type: 'travel', to: h.tl.home, phase: 'returning', load: null },
      ], id)
      const pickAt = startOf(segs, 'loading').t0
      const deliveredAt = startOf(segs, 'unloading').t1
      inventory.push({ t: pickAt, kind: 'kanban', slotId: slot.id, delta: -1 })
      q.push(pickAt, { type: 'picked', slotId: slot.id, index })
      q.push(deliveredAt, { type: 'pouDelivered', station: task.station, pn: task.pn })
      tasks.push({ id, kind: 'pou-delivery', handler: h.tl.id, pn: task.pn, from, to, requestedAt: task.requestedAt, dispatchedAt: t, departAt: depart, pickAt, deliveredAt, doneAt: segs[segs.length - 1].t1 })
      stats.deliveries++
      setFree(h, h.tl.home, segs[segs.length - 1].t1)
      clsTasks.splice(i, 1)
      i--
    }
  }

  function dispatchDsv(t: number) {
    while (dsvTasks.length) {
      const free = idle('DSV', t)
      if (!free.length) return
      const task = dsvTasks.shift()!
      const from = stageDwellId(task.stage)
      const pos = refillPos.get(task.slotId)!
      refillPos.set(task.slotId, pos + 1)
      const to = kanbanDwellId(task.slotId, pos)
      const h = nearest(free, from)
      const id = `T${tasks.length + 1}`
      const load = { pn: task.pn }
      const { depart, segs } = commit(h, t, [
        { type: 'travel', to: from, phase: 'to-pick', load: null },
        { type: 'dwell', phase: 'loading', dur: cfg.loadS, lift0: 0, lift1: 1, load },
        { type: 'travel', to, phase: 'transporting', load },
        { type: 'dwell', phase: 'unloading', dur: cfg.unloadS, lift0: 1, lift1: 0, load },
        { type: 'travel', to: h.tl.home, phase: 'returning', load: null },
      ], id)
      const pickAt = startOf(segs, 'loading').t0
      const deliveredAt = startOf(segs, 'unloading').t1
      inventory.push({ t: pickAt, kind: 'stage', slot: task.stage, pn: null })
      inventory.push({ t: deliveredAt, kind: 'kanban', slotId: task.slotId, delta: 1 })
      q.push(pickAt, { type: 'refillPicked', slotId: task.slotId, pos })
      q.push(pickAt, { type: 'stageFreed', slot: task.stage })
      q.push(deliveredAt, { type: 'refilled', slotId: task.slotId })
      tasks.push({ id, kind: 'kanban-refill', handler: h.tl.id, pn: task.pn, from, to, requestedAt: task.requestedAt, dispatchedAt: t, departAt: depart, pickAt, deliveredAt, doneAt: segs[segs.length - 1].t1 })
      stats.refillTrips++
      setFree(h, h.tl.home, segs[segs.length - 1].t1)
    }
  }

  function placeStaged(t: number) {
    for (let i = 0; i < stageOcc.length && pendingStage.length; i++) {
      if (stageOcc[i] !== null || stageReserved[i]) continue
      const next = pendingStage.shift()!
      stageOcc[i] = next.pn
      stageReserved[i] = true
      inventory.push({ t, kind: 'stage', slot: i, pn: next.pn })
      dsvTasks.push({ stage: i, slotId: next.slotId, pn: next.pn, requestedAt: t })
      const c = openCycle.get(next.slotId)
      if (c && c.stagedAt === undefined) c.stagedAt = t
    }
  }

  function startPrep(t: number) {
    while (prepBusy < cfg.dsvPrepTeams && prepQueue.length) {
      const slotId = prepQueue.shift()!
      prepBusy++
      if (!slotId.startsWith('reserve:')) {
        setCard(t, slotId, 'PREPARING')
        openCycle.get(slotId)!.prepStartAt = t
      }
      q.push(t + cfg.dsvPrepMin * 60, { type: 'prepDone', slotId })
    }
  }

  /** Prepared pallets for a Kanban join the staging queue. */
  function stagePallets(t: number, slotId: string) {
    const slot = LAYOUT.slots.find((s) => s.id === slotId)!
    for (let i = 0; i < slot.pallets.length; i++) pendingStage.push({ slotId: slot.id, pn: slot.pn })
    placeStaged(t)
  }

  /** Raise a POU delivery once the pallet covers fewer racks than the reorder point. */
  function checkPou(t: number, station: string, part: KanbanPart) {
    const key = `${station}:${part.pn}`
    if (requested.has(key) || pouPieces.get(key)! >= part.qtyPerRack! * cfg.pouReorderRacks) return
    requested.add(key)
    clsTasks.push({ station, pn: part.pn, requestedAt: t, short: false })
  }

  function consume(t: number, station: string, rack: number) {
    const model = modelOf(rack)
    const st = LAYOUT.stations.find((s) => s.id === station)!
    for (const p of st.pou) {
      const part = getPart(p.pn)
      if (!isTracked(part) || !part.models.includes(model)) continue
      const key = `${station}:${p.pn}`
      const need = part.qtyPerRack!
      const have = pouPieces.get(key)!
      const owed = backorder.get(key)!
      if (owed === 0 && have >= need) {
        pouPieces.set(key, have - need)
        inventory.push({ t, kind: 'pou', key, pieces: have - need, consumed: need })
      } else {
        // The rack passes short. The pieces are fitted when the next pallet arrives.
        backorder.set(key, owed + need)
        inventory.push({ t, kind: 'starve', key, backorder: owed + need })
        let s = openStarve.get(key)
        if (!s) {
          s = { key, station, pn: p.pn, from: t, racks: 0, pieces: 0 }
          openStarve.set(key, s)
          starvations.push(s)
          stats.starvationEvents++
        }
        s.racks++
        s.pieces += need
      }
      checkPou(t, station, part)
    }
  }

  // ---- Paced line ----
  let blocked: LineBlock | null = null
  let waitingFor: string[] = []

  /** POUs that cannot supply the rack in front of their station at line index j. */
  function shortAt(j: number): string[] {
    const out: string[] = []
    for (const st of LAYOUT.stations) {
      const model = modelOf(j - stationStep(st.id))
      for (const p of st.pou) {
        const part = getPart(p.pn)
        if (!isTracked(part) || !part.models.includes(model)) continue
        const key = `${st.id}:${p.pn}`
        if (pouPieces.get(key)! < part.qtyPerRack!) out.push(key)
      }
    }
    return out
  }

  /** Release the line: every rack starts its transfer to the next station. */
  function indexLine(t: number, j: number) {
    indexTimes[j] = t
    for (const st of lineStations) {
      const k = stationStep(st.id)
      inventory.push({ t, kind: 'rack', station: st.id, rack: j - k, model: modelOf(j - k), last: k === lastStep })
    }
    q.push(t + transferS, { type: 'assemble', j })
    q.push(t + takt, { type: 'complete', rack: j - lastStep })
    q.push(t + takt, { type: 'index', j: j + 1 })
  }

  /** Racks have arrived: each station fits its parts (sub-assembly builds for the rack at station 2). */
  function assemble(t: number, j: number) {
    for (const st of LAYOUT.stations) consume(t, st.id, j - stationStep(st.id))
  }

  /** Index the line if every station has its parts; otherwise stop (or stay stopped) and wait. */
  function tryIndex(t: number, j: number) {
    if (cfg.shortage === 'block') {
      const keys = shortAt(j)
      if (keys.length) {
        if (!blocked) {
          blocked = { from: t, index: j, keys: [...keys] }
          blocks.push(blocked)
          stats.blockEvents++
          inventory.push({ t, kind: 'line', blocked: true, keys })
        } else if (keys.join() !== waitingFor.join()) {
          // Still stopped, but waiting for a different set of parts now.
          for (const k of keys) if (!blocked.keys.includes(k)) blocked.keys.push(k)
          inventory.push({ t, kind: 'line', blocked: true, keys })
        }
        waitingFor = keys
        return
      }
      if (blocked) {
        blocked.to = t
        stats.blockedSec += t - blocked.from
        blocked = null
        inventory.push({ t, kind: 'line', blocked: false, keys: [] })
      }
    }
    indexLine(t, j)
  }

  for (const st of LAYOUT.stations) for (const p of st.pou) {
    const part = getPart(p.pn)
    if (isTracked(part)) checkPou(0, st.id, part)
  }

  // ---- Event loop ----
  for (let e = q.pop(); e && e.t <= horizon; e = q.pop()) {
    const { t, ev } = e
    switch (ev.type) {
      case 'index':
        tryIndex(t, ev.j)
        break
      case 'assemble':
        assemble(t, ev.j)
        break
      case 'complete':
        stats.racksCompleted++
        inventory.push({ t, kind: 'complete', rack: ev.rack, model: modelOf(ev.rack) })
        break
      case 'pouDelivered': {
        const key = `${ev.station}:${ev.pn}`
        const part = getPart(ev.pn)
        requested.delete(key)
        let pieces = pouPieces.get(key)! + part.qtyPerPallet!
        const owed = backorder.get(key)!
        const served = Math.min(owed, pieces)
        pieces -= served
        pouPieces.set(key, pieces)
        inventory.push({ t, kind: 'pou', key, pieces, consumed: served })
        if (owed > 0) {
          backorder.set(key, owed - served)
          inventory.push({ t, kind: 'starve', key, backorder: owed - served })
          if (owed === served) {
            openStarve.get(key)!.to = t
            openStarve.delete(key)
          }
        }
        checkPou(t, ev.station, part)
        // tryIndex reassigns `blocked` inside a closure, which TypeScript's narrowing cannot see.
        const stopped = blocked as LineBlock | null
        if (stopped) tryIndex(t, stopped.index)
        break
      }
      case 'picked': {
        const slot = LAYOUT.slots.find((s) => s.id === ev.slotId)!
        if (card.get(slot.id) !== 'IN_USE') setCard(t, slot.id, 'IN_USE')
        if (ev.index === 0) {
          // Last pallet taken: the card goes on the board for DSV to collect at the next inspection.
          setCard(t, slot.id, 'EMPTY')
          const c: CardCycle = { slotId: slot.id, pn: slot.pn, emptyAt: t, dueAt: t + cfg.leadTimeH * 3600 }
          cycles.push(c)
          openCycle.set(slot.id, c)
        }
        break
      }
      case 'inspect':
        inspections.push(t)
        inventory.push({ t, kind: 'inspect' })
        for (const slot of LAYOUT.slots) {
          const state = card.get(slot.id)
          if (state === 'EMPTY') {
            setCard(t, slot.id, 'REQUESTED')
            const c = openCycle.get(slot.id)!
            c.requestedAt = t
            const spare = reserve.get(slot.pn) ?? 0
            if (spare > 0) {
              // A prepared third Kanban goes straight to staging; DSV re-prepares the spare.
              reserve.set(slot.pn, spare - 1)
              setCard(t, slot.id, 'PREPARING')
              c.prepStartAt = t
              stagePallets(t, slot.id)
              prepQueue.push(`reserve:${slot.pn}`)
            } else {
              prepQueue.push(slot.id)
            }
          } else if (state === 'REPLENISHED') {
            // DSV files the card as Delivered; the Kanban waits full behind the one in use.
            setCard(t, slot.id, 'FULL')
          }
        }
        startPrep(t)
        break
      case 'prepDone':
        prepBusy--
        if (ev.slotId.startsWith('reserve:')) {
          const pn = ev.slotId.slice(8)
          reserve.set(pn, reserve.get(pn)! + 1)
        } else {
          stagePallets(t, ev.slotId)
        }
        startPrep(t)
        break
      case 'refillPicked':
        if (ev.pos === 0) {
          setCard(t, ev.slotId, 'IN_TRANSIT')
          openCycle.get(ev.slotId)!.inTransitAt = t
        }
        break
      case 'stageFreed':
        stageOcc[ev.slot] = null
        stageReserved[ev.slot] = false
        placeStaged(t)
        break
      case 'refilled': {
        const slot = LAYOUT.slots.find((s) => s.id === ev.slotId)!
        const n = (avail.get(slot.id) ?? 0) + 1
        avail.set(slot.id, n)
        if (n === slot.pallets.length) {
          ready.set(slot.id, true)
          setCard(t, slot.id, 'REPLENISHED')
          const c = openCycle.get(slot.id)!
          c.replenishedAt = t
          c.late = t > c.dueAt
          openCycle.delete(slot.id)
          stats.cardsReplenished++
          if (c.late) stats.lateCards++
        }
        break
      }
      case 'handlerFree':
        break
    }
    dispatchCls(t)
    dispatchDsv(t)
  }

  // Cards still open at the horizon are late if already past due.
  for (const c of openCycle.values()) if (c.dueAt <= horizon) { c.late = true; stats.lateCards++ }
  const stillBlocked = blocked as LineBlock | null
  if (stillBlocked) stats.blockedSec += horizon - stillBlocked.from

  inventory.sort((a, b) => a.t - b.t)
  for (const h of hs) {
    const last = h.tl.segs[h.tl.segs.length - 1]
    if (last.t1 < horizon) {
      const pose = poseInSeg(last, last.t1)
      h.tl.segs.push({ kind: 'dwell', t0: last.t1, t1: horizon, pos: { x: pose.x, z: pose.z }, yaw0: pose.yaw, yaw1: pose.yaw, lift0: 0, lift1: 0, phase: 'idle', load: null, taskId: null })
    }
    // The initial park segment was zero-length; give it a real span.
    const first = h.tl.segs[0] as DwellSeg
    if (h.tl.segs.length > 1) first.t1 = h.tl.segs[1].t0
  }
  return {
    config: cfg, horizon, takt, handlers: hs.map((h) => h.tl), inventory, tasks, cycles, starvations, blocks, inspections,
    initialPieces, initialKanban, targetRacks, reservePieces, stats, conflicts,
    indexTimes, transferS, assemblyS: takt - transferS, firstRack, rackModels: models,
  }
}

// ---- Snapshots for rendering and tests ----

export interface CardSnapshot { state: KanbanState; since: number }

export interface InventorySnapshot {
  /** Pallets present per Kanban slot. */
  kanban: Map<string, number>
  /** Pieces at each point of use (tracked parts only). */
  pou: Map<string, number>
  stage: (string | null)[]
  cards: Map<string, CardSnapshot>
  /** Pieces owed per POU while starved. */
  backorder: Map<string, number>
  /** Rack currently at each line station. */
  atStation: Map<string, { rack: number; model: Model }>
  /** Pieces fitted to racks so far. */
  consumed: number
  /** Pieces DSV has staged so far. */
  received: number
  racksCompleted: number
  lastInspection: number | null
  /** Paced line state: stopped since `since`, waiting for `keys`. */
  line: { blocked: boolean; since: number; keys: string[] }
}

export function initialSnapshot(result: MovementResult): InventorySnapshot {
  return {
    kanban: new Map(LAYOUT.slots.map((s) => [s.id, result.initialKanban[s.id] ?? s.pallets.length])),
    pou: new Map(),
    stage: LAYOUT.stagingSlots.map(() => null),
    cards: new Map(),
    backorder: new Map(),
    atStation: new Map(),
    consumed: 0,
    received: 0,
    racksCompleted: 0,
    lastInspection: null,
    line: { blocked: false, since: 0, keys: [] },
  }
}

export function cloneSnapshot(s: InventorySnapshot): InventorySnapshot {
  return {
    ...s, kanban: new Map(s.kanban), pou: new Map(s.pou), stage: [...s.stage], cards: new Map(s.cards),
    backorder: new Map(s.backorder), atStation: new Map(s.atStation),
  }
}

export function applyEvent(s: InventorySnapshot, e: InvEvent) {
  switch (e.kind) {
    case 'kanban': s.kanban.set(e.slotId, s.kanban.get(e.slotId)! + e.delta); break
    case 'pou': s.pou.set(e.key, e.pieces); s.consumed += e.consumed; break
    case 'stage': if (e.pn) s.received += getPart(e.pn).qtyPerPallet ?? 0; s.stage[e.slot] = e.pn; break
    case 'kstate': s.cards.set(e.slotId, { state: e.state, since: e.t }); break
    case 'starve': if (e.backorder) s.backorder.set(e.key, e.backorder); else s.backorder.delete(e.key); break
    case 'rack': s.atStation.set(e.station, { rack: e.rack, model: e.model }); break
    case 'complete': s.racksCompleted++; break
    case 'inspect': s.lastInspection = e.t; break
    case 'line': s.line = { blocked: e.blocked, since: e.blocked && s.line.blocked ? s.line.since : e.t, keys: e.keys }; break
  }
}

/** Number of inventory events at or before `t` (binary search). */
export function eventIndexAt(events: InvEvent[], t: number): number {
  let lo = 0, hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].t <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function snapshotAt(result: MovementResult, t: number): InventorySnapshot {
  const s = initialSnapshot(result)
  const n = eventIndexAt(result.inventory, t)
  for (let i = 0; i < n; i++) applyEvent(s, result.inventory[i])
  return s
}

/** Display id of a rack: racks on the line at shift start are R-001 to R-008. */
export const rackId = (rack: number) => `R-${String(rack + LAYOUT.stations.filter((s) => s.id !== 'SUBASSY').length).padStart(3, '0')}`

/** Racks the line would have completed by time t without stops. */
export const targetBy = (result: MovementResult, t: number) => Math.min(result.targetRacks, Math.floor(t / result.takt))

/** The card cycle a Kanban is in (or last completed) at time t. */
export function cycleAt(result: MovementResult, slotId: string, t: number): CardCycle | null {
  let found: CardCycle | null = null
  for (const c of result.cycles) if (c.slotId === slotId && c.emptyAt <= t) found = c
  return found
}

/** Pieces of a part on one Kanban slot, or null when the pallet quantity is unknown. */
export function kanbanPieces(s: InventorySnapshot, slotId: string, part: KanbanPart): number | null {
  return part.qtyPerPallet ? (s.kanban.get(slotId) ?? 0) * part.qtyPerPallet : null
}

export function poseAt(h: HandlerTimeline, t: number): Pose {
  return sampleSegs(h.segs, t)
}
