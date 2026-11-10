import { getPart } from '../data/parts'
import { loadProfile, type AssetId, type LoadProfile } from '../assets/manifest'
import { PALLET, RACKING, SERVER_RACK } from '../layout/constants'
import { LAYOUT, type Vec2 } from '../layout/factoryLayout'
import { poseAt } from '../sim/movementSim'
import { rackAt } from '../sim/assemblyLine'
import { simClock, useSim } from '../store/simStore'

/**
 * Every clickable thing in the scene has a string id. The id alone is enough to find what it is,
 * where it is and how big it is, so selection can come from the 3D view, a table row or a search.
 *
 *   kanban:<pn>#<k>:<p>   pallet p of Kanban k        pou:<station>:<pn>   POU pallet
 *   rack:<station>        rack on the line            station:<id>         workstation (bench)
 *   finished:<i>          finished rack in staging    equip:<asset>:<i>    board, shelving, jack, cart
 *   dsv:<i>               illustrative DSV stock   stage:<i>            prepared pallet in DSV staging
 *   handler:<id>          material handler (moves; resolved from the live simulation)
 */
export type EntityKind = 'kanbanPallet' | 'pouPallet' | 'lineRack' | 'station' | 'finishedRack' | 'equipment' | 'dsvStock' | 'stagePallet' | 'handler' | 'assemblyRack'

export interface Bounds { x: number; y: number; z: number; w: number; h: number; d: number }

export interface Entity {
  id: string
  kind: EntityKind
  label: string
  bounds: Bounds
  pn?: string
  slotId?: string
  palletIndex?: number
  stationId?: string
  assetId?: AssetId
  handlerId?: string
  /** Rack number of an assembly-line rack (display id via rackId). */
  rackNo?: number
  /** Moves or changes with simulation time; bounds are only valid for the moment of resolution. */
  dynamic?: boolean
}

const loadBounds = (c: Vec2, profile: LoadProfile | null, y = 0, rotated = false): Bounds => {
  // rotated = pallet length along X (POU, staging, DSV racking)
  const h = PALLET.height + (profile?.height ?? 0)
  const [w, d] = rotated ? [PALLET.length, PALLET.width] : [PALLET.width, PALLET.length]
  return { x: c.x, y: y + h / 2, z: c.z, w, h, d }
}

const rackBounds = (c: Vec2, faceX: boolean): Bounds => ({
  x: c.x, y: SERVER_RACK.height / 2, z: c.z,
  w: faceX ? SERVER_RACK.depth : SERVER_RACK.width, h: SERVER_RACK.height, d: faceX ? SERVER_RACK.width : SERVER_RACK.depth,
})

// ---- Equipment placement (shared by the scene and the resolver) ----

export const EQUIPMENT: { assetId: AssetId; label: string; at: Vec2; rotY: number; size: [number, number, number] }[] = [
  { assetId: 'kanbanBoard', label: 'Kanban board', at: LAYOUT.kanbanBoard, rotY: 0, size: [0.6, 2.15, 3.65] },
  ...LAYOUT.smallPartsRacks.map((p) => ({ assetId: 'twoBinShelving' as const, label: 'Small parts 2-bin shelving', at: p, rotY: 0, size: [1.8, 1.9, 0.6] as [number, number, number] })),
  ...LAYOUT.carts.map((p) => ({ assetId: 'cart' as const, label: 'Platform cart (spare)', at: p, rotY: Math.PI, size: [0.8, 1.05, 1.4] as [number, number, number] })),
]

export const equipmentId = (assetId: AssetId, index: number) => `equip:${assetId}:${index}`

/** Index of each equipment entry within its asset type, matching the instance order in the scene. */
export function equipmentByAsset(assetId: AssetId) {
  return EQUIPMENT.filter((e) => e.assetId === assetId).map((e, i) => ({ ...e, id: equipmentId(assetId, i) }))
}

// ---- DSV stock: generated, illustrative ----

function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

export interface DsvPallet { x: number; z: number; y: number; profile: LoadProfile }

export const DSV_STOCK: DsvPallet[] = (() => {
  const rnd = seeded(42)
  const out: DsvPallet[] = []
  for (const b of LAYOUT.rackingBays) {
    RACKING.levels.forEach((level, li) => {
      for (const dz of [-0.66, 0.66]) {
        if (rnd() > 0.78) continue
        const maxH = li < RACKING.levels.length - 1 ? RACKING.levels[li + 1] - level - 0.4 : 1.2
        const height = Math.min(maxH, 0.7 + rnd() * 0.7)
        out.push({ x: b.x, z: b.z + dz, y: level === 0 ? 0 : level + 0.012, profile: { kind: rnd() > 0.8 ? 'crate' : 'carton', height, confidence: 'placeholder' } })
      }
    })
  }
  return out
})()

// ---- Resolver ----

const cache = new Map<string, Entity | null>()

export function resolveEntity(id: string): Entity | null {
  if (id.startsWith('handler:') || id.startsWith('stage:') || id.startsWith('linerack:')) return resolveDynamic(id)
  if (cache.has(id)) return cache.get(id)!
  const e = resolve(id)
  cache.set(id, e)
  return e
}

function resolve(id: string): Entity | null {
  const [kind, ...rest] = id.split(':')
  const arg = rest.join(':')
  switch (kind) {
    case 'kanban': {
      const [slotId, idx] = [arg.slice(0, arg.lastIndexOf(':')), Number(arg.slice(arg.lastIndexOf(':') + 1))]
      const slot = LAYOUT.slots.find((s) => s.id === slotId)
      const pallet = slot?.pallets[idx]
      if (!slot || !pallet) return null
      const part = getPart(slot.pn)
      return { id, kind: 'kanbanPallet', label: `${part.pn} · ${part.description}`, bounds: loadBounds(pallet, loadProfile(part)), pn: slot.pn, slotId, palletIndex: idx }
    }
    case 'pou': {
      const [stationId, pn] = rest
      const pos = LAYOUT.stations.find((s) => s.id === stationId)?.pou.find((p) => p.pn === pn)
      if (!pos) return null
      const part = getPart(pn)
      return { id, kind: 'pouPallet', label: `POU ${stationId} · ${part.description}`, bounds: loadBounds(pos, loadProfile(part), 0, true), pn, stationId }
    }
    case 'rack': {
      const st = LAYOUT.stations.find((s) => s.id === arg)
      if (!st) return null
      return { id, kind: 'lineRack', label: `Rack at ${st.id}`, bounds: rackBounds(st.rack, true), stationId: st.id }
    }
    case 'station': {
      const st = LAYOUT.stations.find((s) => s.id === arg)
      if (!st) return null
      // Frame the rack, bench and POU together.
      const xs = [st.rack.x, st.bench.x, ...st.pou.map((p) => p.x)]
      const zs = [st.rack.z, st.bench.z, ...st.pou.map((p) => p.z)]
      const minX = Math.min(...xs) - 0.8, maxX = Math.max(...xs) + 0.8
      const minZ = Math.min(...zs) - 1, maxZ = Math.max(...zs) + 1
      return { id, kind: 'station', label: st.label, bounds: { x: (minX + maxX) / 2, y: 1.1, z: (minZ + maxZ) / 2, w: maxX - minX, h: 2.3, d: maxZ - minZ }, stationId: st.id }
    }
    case 'finished': {
      const p = LAYOUT.finishedRackSpots[Number(arg)]
      return p ? { id, kind: 'finishedRack', label: `Finished rack ${Number(arg) + 1}`, bounds: rackBounds(p, false) } : null
    }
    case 'equip': {
      const [assetId, idx] = rest
      const e = equipmentByAsset(assetId as AssetId)[Number(idx)]
      if (!e) return null
      const [w, h, d] = e.size
      return { id, kind: 'equipment', label: e.label, bounds: { x: e.at.x, y: h / 2, z: e.at.z, w, h, d }, assetId: e.assetId }
    }
    case 'dsv': {
      const p = DSV_STOCK[Number(arg)]
      return p ? { id, kind: 'dsvStock', label: 'DSV stock (illustrative)', bounds: loadBounds(p, p.profile, p.y, true) } : null
    }
  }
  return null
}

/** Handlers and staged pallets change with simulation time, so they are resolved fresh each call. */
function resolveDynamic(id: string): Entity | null {
  const [kind, arg] = id.split(':')
  const sim = useSim.getState()
  if (kind === 'linerack') {
    const v = rackAt(sim.result, Number(arg), simClock.t)
    if (!v) return null
    return { id, kind: 'assemblyRack', label: `${v.id} · ${v.model}`, bounds: { x: v.x, y: v.y + SERVER_RACK.height / 2, z: v.z, w: SERVER_RACK.depth, h: SERVER_RACK.height, d: SERVER_RACK.width }, rackNo: v.rack, dynamic: true }
  }
  if (kind === 'handler') {
    const h = sim.result.handlers.find((x) => x.id === arg)
    if (!h) return null
    const p = poseAt(h, simClock.t)
    // Cargo is shown live in the details panel; the label must not go stale while selected.
    return { id, kind: 'handler', label: `${h.role} handler ${h.id}`, bounds: { x: p.x, y: 0.9, z: p.z, w: 1.4, h: 1.8, d: 1.4 }, handlerId: h.id, dynamic: true }
  }
  const i = Number(arg)
  const pn = sim.snapshot.stage[i]
  const pos = LAYOUT.stagingSlots[i]
  if (!pos || !pn) return null
  const part = getPart(pn)
  return { id, kind: 'stagePallet', label: `Staged · ${part.description}`, bounds: loadBounds(pos, loadProfile(part), 0, true), pn, dynamic: true }
}

/** The Kanban slot rectangle for a Kanban pallet, so selecting one pallet outlines its whole Kanban. */
export function slotBounds(slotId: string): Bounds | null {
  const slot = LAYOUT.slots.find((s) => s.id === slotId)
  if (!slot) return null
  const r = slot.rect
  const h = PALLET.height + loadProfile(getPart(slot.pn)).height
  return { x: (r.minX + r.maxX) / 2, y: h / 2, z: (r.minZ + r.maxZ) / 2, w: r.maxX - r.minX, h, d: r.maxZ - r.minZ }
}
