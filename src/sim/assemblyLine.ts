import { getPart, KANBAN_PARTS, type Model } from '../data/parts'
import { LAYOUT, type Vec2 } from '../layout/factoryLayout'
import { LINE } from '../layout/constants'
import { rackId, type MovementResult } from './movementSim'
import { buildPath, distanceAt, makeProfile, pointAt, type Path, type Profile } from './path'

/**
 * The physical assembly line, derived from the material-flow run. Nothing here keeps state: a
 * rack's lifecycle, position and installed parts, and each station's state, are pure functions of
 * the run and the simulation time. So pause, playback speed and reset need no special handling,
 * and the 3D view, panels and tests all read the same answer.
 *
 * Timing (see movementSim): line index j starts at indexTimes[j]. Every rack then rides the
 * conveyor to its next station (transferS), assembles for the rest of the takt (assemblyS), and
 * waits if the next index is late (the line is stopped for material).
 */

export const LINE_STATIONS = LAYOUT.stations.filter((s) => s.id !== 'SUBASSY')
export const N_STATIONS = LINE_STATIONS.length
export const WORKERS_PER_STATION = 2

export type RackState =
  | 'CREATED' | 'WAITING_FOR_WS1' | 'MOVING_TO_STATION' | 'AT_STATION' | 'ASSEMBLING' | 'ASSEMBLY_COMPLETE'
  | 'WAITING_FOR_TRANSFER' | 'MOVING_TO_NEXT_STATION' | 'WS8_COMPLETE' | 'MOVING_TO_FINISHED_STAGING' | 'COMPLETED'

export const RACK_STATE_LABEL: Record<RackState, string> = {
  CREATED: 'Created', WAITING_FOR_WS1: 'Loading at WS1', MOVING_TO_STATION: 'Moving to station', AT_STATION: 'At station',
  ASSEMBLING: 'Assembling', ASSEMBLY_COMPLETE: 'Assembly complete', WAITING_FOR_TRANSFER: 'Waiting for transfer',
  MOVING_TO_NEXT_STATION: 'Moving to next station', WS8_COMPLETE: 'WS8 complete', MOVING_TO_FINISHED_STAGING: 'To finished staging',
  COMPLETED: 'Completed',
}

export interface RackView {
  rack: number
  id: string
  model: Model
  state: RackState
  /** Line station index (0 = WS1) the rack is at or moving into; null once it has left WS8. */
  station: number | null
  /** Stations whose work is finished on this rack (0–8). */
  stationsDone: number
  /** Overall progress 0–1: finished stations plus the share of the current assembly window. */
  progress: number
  x: number
  y: number
  z: number
  /** When the rack entered its current state. */
  since: number
  /** When it started moving into its current station (null off the line). */
  atStationSince: number | null
  /** When it was loaded at WS1; null for racks already on the line when the shift started. */
  createdAt: number | null
  completedAt: number | null
}

/** Last line index started at or before t, or -1 before the first. */
export function lineIndexAt(result: MovementResult, t: number): number {
  const xs = result.indexTimes
  let lo = 0, hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

const modelOf = (result: MovementResult, rack: number) => result.rackModels[rack - result.firstRack]

/** When rack r entered station k (k = 8: left WS8 for staging), or undefined if not (yet). */
const entry = (result: MovementResult, rack: number, k: number): number | undefined =>
  rack + k >= 0 ? result.indexTimes[rack + k] : undefined

const transferCache = new WeakMap<MovementResult, Profile>()
function transferProfile(result: MovementResult): Profile {
  let p = transferCache.get(result)
  if (!p) {
    p = makeProfile(LINE.stationPitch, result.config.conveyorSpeed, result.config.conveyorAccel)
    transferCache.set(result, p)
  }
  return p
}

/** Staging spot for the n-th completed rack. Spots are reused once full (oldest racks have shipped). */
export const stagingSpot = (n: number) => LAYOUT.finishedRackSpots[((n % LAYOUT.finishedRackSpots.length) + LAYOUT.finishedRackSpots.length) % LAYOUT.finishedRackSpots.length]

interface Outfeed { path: Path; profile: Profile; tableStart: number; tableEnd: number }
const outfeedCache = new Map<string, Outfeed>()
/** WS8 → conveyor → lowering table → floor lane → staging spot, with its speed profile. */
export function outfeedFor(result: MovementResult, spot: Vec2): Outfeed {
  const key = `${spot.x},${spot.z},${result.config.outfeedSpeed},${result.config.conveyorAccel}`
  let o = outfeedCache.get(key)
  if (!o) {
    const c = LAYOUT.conveyor
    const conveyorPath = buildPath(c.outfeed, 0)
    const path = buildPath([...c.outfeed, ...c.stagingLane.slice(1), { x: spot.x, z: c.laneZ }, spot], 0)
    o = { path, profile: makeProfile(path.length, result.config.outfeedSpeed, result.config.conveyorAccel), tableStart: conveyorPath.length - 1, tableEnd: conveyorPath.length }
    outfeedCache.set(key, o)
  }
  return o
}

/** Rack deck height: on the conveyor carrier, lowered at the end table, then on its own casters. */
function deckY(o: Outfeed, s: number, bed: number) {
  if (s <= o.tableStart) return bed
  if (s >= o.tableEnd) return 0
  return bed * (1 - (s - o.tableStart) / (o.tableEnd - o.tableStart))
}

/** Where a rack is and what has been done to it at time t, or null if it does not exist yet. */
export function rackAt(result: MovementResult, rack: number, t: number): RackView | null {
  if (rack < result.firstRack) return null
  const T = result.takt, tau = result.transferS
  const stops = LAYOUT.conveyor.stops
  const bed = LAYOUT.conveyor.bedHeight
  const id = rackId(rack)
  const model = modelOf(result, rack)
  if (!model) return null
  // Racks already on the line at the start of the shift have the stations before theirs done.
  const preDone = Math.max(0, -rack)
  const createdAt = rack >= 0 ? result.indexTimes[rack] ?? null : null
  const base = { rack, id, model, createdAt, completedAt: null as number | null }

  let k = -1
  for (let i = Math.max(0, -rack); i <= N_STATIONS; i++) {
    const e = entry(result, rack, i)
    if (e === undefined || e > t) break
    k = i
  }
  if (k < 0) {
    if (rack >= 0) return null
    // Line not released yet (stopped at shift start): the rack waits where it was, work done.
    const at = preDone - 1
    return { ...base, state: 'WAITING_FOR_TRANSFER', station: at, stationsDone: preDone, progress: preDone / N_STATIONS, x: stops[at].x, y: bed, z: stops[at].z, since: 0, atStationSince: 0 }
  }

  const e = entry(result, rack, k)!
  const dt = t - e
  if (k === N_STATIONS) {
    const n = rack - result.firstRack
    const spot = stagingSpot(n)
    const o = outfeedFor(result, spot)
    const completedAt = entry(result, rack, N_STATIONS - 1)! + T
    if (dt < o.profile.duration) {
      const s = distanceAt(o.profile, dt)
      const p = pointAt(o.path, s)
      return { ...base, completedAt, state: 'MOVING_TO_FINISHED_STAGING', station: null, stationsDone: N_STATIONS, progress: 1, x: p.x, y: deckY(o, s, bed), z: p.z, since: e, atStationSince: null }
    }
    return { ...base, completedAt, state: 'COMPLETED', station: null, stationsDone: N_STATIONS, progress: 1, x: spot.x, y: 0, z: spot.z, since: e + o.profile.duration, atStationSince: null }
  }

  const done = k + (dt >= T ? 1 : 0)
  const assembling = dt >= tau && dt < T
  const progress = (k + (dt >= T ? 1 : assembling ? (dt - tau) / (T - tau) : 0)) / N_STATIONS
  let x = stops[k].x, z = stops[k].z, state: RackState, since: number
  if (dt < tau) {
    // Same timing for every carrier, so racks that move together keep their spacing.
    const f = distanceAt(transferProfile(result), dt) / LINE.stationPitch
    const from = k === 0 ? LAYOUT.conveyor.load : stops[k - 1]
    x = from.x + (stops[k].x - from.x) * f
    z = from.z + (stops[k].z - from.z) * f
    state = k === 0 ? (dt === 0 ? 'CREATED' : 'MOVING_TO_STATION') : 'MOVING_TO_NEXT_STATION'
    since = e
  } else if (dt < T) {
    state = 'ASSEMBLING'
    since = e + tau
  } else {
    state = k === N_STATIONS - 1 ? 'WS8_COMPLETE' : 'WAITING_FOR_TRANSFER'
    since = e + T
  }
  return { ...base, completedAt: k === N_STATIONS - 1 && dt >= T ? e + T : null, state, station: k, stationsDone: done, progress, x, y: bed, z, since, atStationSince: e }
}

/**
 * Every rack worth drawing at t: the eight on the line, any on the outfeed, and the most recent
 * completed racks that fit in staging (older ones have shipped).
 */
export function racksAt(result: MovementResult, t: number): RackView[] {
  const j = lineIndexAt(result, t)
  const newest = Math.max(j, -1)
  const out: RackView[] = []
  const keep = LAYOUT.finishedRackSpots.length
  for (let r = Math.max(result.firstRack, newest - N_STATIONS - keep); r <= newest; r++) {
    const v = rackAt(result, r, t)
    if (v) out.push(v)
  }
  // A staging spot is reused every `keep` racks: once a newer rack is heading to (or parked in)
  // the same spot, the older one has shipped.
  const latest = Math.max(-Infinity, ...out.filter((v) => v.station === null).map((v) => v.rack))
  return out.filter((v) => v.state !== 'COMPLETED' || v.rack + keep > latest)
}

export type StationState = 'transfer' | 'assembling' | 'waiting' | 'blocked' | 'empty'

export interface StationView {
  station: number
  id: string
  rack: RackView | null
  state: StationState
  /** Assembly progress at this station 0–1. */
  progress: number
  /** Seconds left in the assembly window, while assembling. */
  remaining: number | null
  /** Parts (station:pn keys) this station is short of while the line is stopped. */
  short: string[]
}

/** Stop in force at t (the line is waiting for material), if any. */
export function blockAt(result: MovementResult, t: number) {
  return result.blocks.find((b) => b.from <= t && (b.to === undefined || t < b.to)) ?? null
}

export function stationAt(result: MovementResult, k: number, t: number): StationView {
  const id = LINE_STATIONS[k].id
  const j = lineIndexAt(result, t)
  const rack = rackAt(result, j - k, t)
  const empty: StationView = { station: k, id, rack: null, state: 'empty', progress: 0, remaining: null, short: [] }
  if (!rack || rack.station !== k) return empty
  const stop = blockAt(result, t)
  const short = stop ? stop.keys.filter((key) => key.startsWith(`${id}:`) || (id === 'WS4' && key.startsWith('SUBASSY:'))) : []
  const dt = t - (result.indexTimes[j] ?? 0)
  if (rack.state === 'ASSEMBLING') {
    return { station: k, id, rack, state: 'assembling', progress: (dt - result.transferS) / result.assemblyS, remaining: result.takt - dt, short }
  }
  if (rack.state === 'MOVING_TO_NEXT_STATION' || rack.state === 'MOVING_TO_STATION' || rack.state === 'CREATED') {
    return { station: k, id, rack, state: 'transfer', progress: 0, remaining: null, short }
  }
  return { station: k, id, rack, state: short.length ? 'blocked' : 'waiting', progress: 1, remaining: null, short }
}

/** BOM lines a station fits to a rack of this model (tracked or not), from the sheet. */
export function stationParts(stationId: string, model: Model) {
  return KANBAN_PARTS.filter((p) => {
    const ws = p.workstation?.split('&')[0].trim()
    const at = ws === 'SUBASSY' ? 'WS4' : ws
    return at === stationId && p.models.includes(model)
  })
}

/** Installed and pending BOM lines for a rack, station by station. */
export function rackComponents(rack: RackView) {
  const rows = LINE_STATIONS.map((s, k) => ({ station: s.id, done: k < rack.stationsDone, parts: stationParts(s.id, rack.model) }))
  return {
    installed: rows.filter((r) => r.done),
    pending: rows.filter((r) => !r.done),
  }
}

export const partLabel = (pn: string) => {
  const p = getPart(pn)
  return `${p.qtyPerRack ?? '?'} × ${p.description}`
}

/** Racks completed in the hour up to t (the line's current output rate, racks/h). */
export function rateLastHour(result: MovementResult, t: number): number {
  let n = 0
  for (const e of result.inventory) {
    if (e.t > t) break
    if (e.kind === 'complete' && e.t > t - 3600) n++
  }
  return n
}
