import { KANBAN_PARTS, LINE_STATION_DEFS, PLANNING_BASIS, getPart } from '../data/parts'
import {
  AISLES, BACK_GAP, BUILDING, LINE, PALLET, PICK_AISLE, RACKING, ROUTES, ROW_CAPACITY, ROW_PITCH, ROW_SETBACK,
  CONVEYOR, SERVER_RACK, STAGING, WORKER, ZONES,
} from './constants'

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Vec2 { x: number; z: number }

export interface KanbanSlot {
  id: string            // `${pn}#${index}`
  pn: string
  index: number         // 0 or 1: the two Kanbans per part
  aisleId: string
  side: 'N' | 'S'       // which side of the aisle the row is on
  rect: Rect
  pallets: Vec2[]       // pallet centres (length along Z), length === part.kanbanPallets
}

export interface PickAisle { id: string; z: number; rect: Rect }

/** POU pallets are approached along X, so they lie with their length along X. */
export interface PouPosition { pn: string; x: number; z: number }

export interface Station {
  id: string
  /** Short display name: "Station 1 · Chassis". */
  label: string
  /** Operation, e.g. "Chassis" (empty for the sub-assembly). */
  name: string
  /** Sheet assembly steps this station performs (WS1 …). */
  steps: string[]
  /** Length of the station along the line, metres. */
  span: number
  rack: Vec2
  bench: Vec2
  pou: PouPosition[]
  /** Corridor X the POU spurs branch from. */
  serviceX: number
  confidence: 'verified' | 'estimated' | 'placeholder'
}

export interface RackingBay { x: number; z: number; facing: 1 | -1 }
/** Where an idle handler waits. CLS bays branch off the top corridor; DSV bays off the DSV aisle. */
export interface ParkingSpot { x: number; z: number; role: 'CLS' | 'DSV'; junction: Vec2 }
export interface Corridor { id: string; a: Vec2; b: Vec2 }

/** Rack conveyor: station stops, the outfeed to staging, and solid bed footprints. */
export interface Conveyor {
  /** Rack position at each line station, in line order. */
  stops: Vec2[]
  /** Where station 1 loads the next base rack onto a carrier, just upstream of it. */
  load: Vec2
  /** Last stop → east turn → north along the main aisle → lowering table at the end. */
  outfeed: Vec2[]
  /** Lowering table → floor lane between the staging rows (the rack then rolls into its spot). */
  stagingLane: Vec2[]
  laneZ: number
  bedHeight: number
  rects: Rect[]
}

/** Where a station's two assembly workers stand, facing the rack. */
export interface WorkerSpot { id: string; station: string; side: 'A' | 'B'; x: number; z: number; yaw: number }

export interface FactoryLayout {
  building: Rect
  kanbanArea: Rect
  aisles: PickAisle[]
  /** The aisle the M shelves face: the "middle aisle" of slide P5. */
  middleAisle: Rect
  slots: KanbanSlot[]
  stations: Station[]
  rackingBays: RackingBay[]
  columns: Vec2[]
  corridors: Corridor[]
  stagingSlots: Vec2[]
  parkingSpots: ParkingSpot[]
  zones: Record<'dsvRacking' | 'dsvStaging' | 'handlerFloor' | 'finishedStaging' | 'mainAisle' | 'dsvDrop' | 'clsPick', Rect>
  finishedRackSpots: Vec2[]
  smallPartsRacks: Vec2[]
  kanbanBoard: Vec2
  carts: Vec2[]
  conveyor: Conveyor
  workers: WorkerSpot[]
}

/**
 * Kanban order follows the P1 map (racks, rails, top shelves, cable managers, battery shelves,
 * T shelves, busbar/plates/pan, M shelves, centre CM, drain modules), with Yawn and Bloom variants
 * on separate Kanbans (slide P5). Rows are filled first-fit in this order.
 */
export const KANBAN_ORDER: string[] = [
  '1225629',
  '1192744', '1230914', '1192746', '1230916', '1192057', '1192056', '1192055-01',
  '1207172', '1231937', '1231057',
  '1100361-02', '1100362-02',
  '1219362-02',
  '1181838-03',
  '1177652', '1192884', '1181665',
  '1222851', '1222851-01',
  '1206264', '1200907', '1200909', '1199546', '1200637',
  '1231956', '1231954', '1231955',
]

const POU_PITCH = 1.35

const HALF_L = PALLET.length / 2

function buildKanban() {
  const { minX, maxX, minZ } = ZONES.kanban
  const x0 = minX + (maxX - minX - ROW_CAPACITY * ROW_PITCH) / 2

  // First-fit packing of Kanbans into row sides (aisle 0 N, aisle 0 S, aisle 1 N, ...).
  const used: number[] = []
  const placements: { pn: string; index: number; side: number; col: number; n: number }[] = []
  const fit = (n: number) => {
    let side = used.findIndex((u) => u + n <= ROW_CAPACITY)
    if (side < 0) { side = used.length; used.push(0) }
    const col = used[side]
    used[side] += n
    return { side, col }
  }
  for (const pn of KANBAN_ORDER) {
    const n = getPart(pn).kanbanPallets
    if (n > ROW_CAPACITY) throw new Error(`Kanban for ${pn} (${n} pallets) exceeds a row`)
    if (2 * n <= ROW_CAPACITY) {
      // Keep both Kanbans of a part together when they fit in one row side.
      const { side, col } = fit(2 * n)
      for (let k = 0; k < PLANNING_BASIS.kanbansPerPart; k++) placements.push({ pn, index: k, side, col: col + k * n, n })
    } else {
      for (let k = 0; k < PLANNING_BASIS.kanbansPerPart; k++) placements.push({ pn, index: k, ...fit(n), n })
    }
  }

  // Geometry: N row, aisle, S row per aisle; back-to-back rows between aisles.
  const nAisles = Math.ceil(used.length / 2)
  const aisles: PickAisle[] = []
  const rowZ: number[] = []
  let z = minZ + HALF_L
  for (let a = 0; a < nAisles; a++) {
    const north = z
    const top = north + HALF_L + ROW_SETBACK
    const centre = top + PICK_AISLE / 2
    const south = top + PICK_AISLE + ROW_SETBACK + HALF_L
    aisles.push({ id: `A${a + 1}`, z: centre, rect: { minX: ZONES.kanban.minX, maxX: ZONES.kanban.maxX, minZ: top, maxZ: top + PICK_AISLE } })
    rowZ.push(north, south)
    z = south + HALF_L + BACK_GAP + HALF_L
  }

  const slots: KanbanSlot[] = placements.map((p) => {
    const zc = rowZ[p.side]
    const pallets = Array.from({ length: p.n }, (_, i) => ({ x: x0 + (p.col + i + 0.5) * ROW_PITCH, z: zc }))
    return {
      id: `${p.pn}#${p.index}`, pn: p.pn, index: p.index, aisleId: aisles[Math.floor(p.side / 2)].id, side: p.side % 2 ? 'S' : 'N',
      rect: { minX: x0 + p.col * ROW_PITCH, maxX: x0 + (p.col + p.n) * ROW_PITCH, minZ: zc - HALF_L - 0.04, maxZ: zc + HALF_L + 0.04 },
      pallets,
    }
  })

  // If the last aisle only has a north row, the area still has to include that aisle.
  const lastSide = used.length - 1
  const maxZ = lastSide % 2 === 0 ? aisles[aisles.length - 1].rect.maxZ : rowZ[lastSide] + HALF_L
  const kanbanArea = { minX, maxX, minZ, maxZ }
  const mAisle = aisles.find((a) => a.id === slots.find((s) => s.pn === '1222851')!.aisleId)!
  return { aisles, slots, kanbanArea, middleAisle: mAisle.rect }
}

function buildStations(): Station[] {
  // Each part is staged once, at the station that fits it (shared steps: the first one).
  const byStation = new Map<string, string[]>()
  for (const part of KANBAN_PARTS) {
    if (!part.station) continue
    byStation.set(part.station, [...(byStation.get(part.station) ?? []), part.pn])
  }
  const pouFor = (ws: string, x: number, cz: number): PouPosition[] => {
    const pns = byStation.get(ws) ?? []
    return pns.map((pn, i) => ({ pn, x, z: cz + (i - (pns.length - 1) / 2) * POU_PITCH }))
  }

  // Stations sit end to end, each centred on its own span; the rack stops at the centre. The line
  // starts a little south of the top corridor so the first POU pallet keeps clear of it.
  let start = LINE.firstStationZ - 2
  const stations: Station[] = LINE_STATION_DEFS.map((def, i) => {
    const span = Math.max(LINE.minStationSpan, (byStation.get(def.id)?.length ?? 0) * POU_PITCH + LINE.stationSpanMargin)
    const z = start + span / 2
    start += span
    return {
      id: def.id, label: `Station ${i + 1} · ${def.name}`, name: def.name, steps: def.steps, span,
      rack: { x: LINE.rackX, z },
      bench: { x: LINE.rackX + LINE.benchOffsetX, z },
      pou: pouFor(def.id, LINE.pouX, z),
      serviceX: ROUTES.pouLaneX,
      confidence: def.confidence,
    }
  })

  // Sub-assembly builds the M shelf unit consumed at the blades / cassettes station, so it sits on
  // the handler floor opposite that station.
  const feeds = stations[1]
  const subX = ZONES.handlerFloor.maxX - 2.5
  stations.push({
    id: 'SUBASSY', label: 'Sub-assembly', name: '', steps: ['SUBASSY'], span: LINE.minStationSpan,
    rack: { x: subX, z: feeds.rack.z },
    bench: { x: subX, z: feeds.rack.z + 2.4 },
    pou: pouFor('SUBASSY', subX - 2.2, feeds.rack.z),
    serviceX: ROUTES.spineX,
    confidence: 'estimated',
  })
  return stations
}

function buildRacking(): RackingBay[] {
  const bays: RackingBay[] = []
  const flue = 0.15
  const doubleDepth = RACKING.depth * 2 + flue
  const zone = ZONES.dsvRacking
  const nBays = Math.floor((zone.maxZ - zone.minZ) / RACKING.bayWidth)
  for (let x0 = zone.minX; x0 + doubleDepth <= zone.maxX; x0 += doubleDepth + RACKING.rowGap) {
    for (let b = 0; b < nBays; b++) {
      const z = zone.minZ + (b + 0.5) * RACKING.bayWidth
      bays.push({ x: x0 + RACKING.depth / 2, z, facing: -1 })
      bays.push({ x: x0 + doubleDepth - RACKING.depth / 2, z, facing: 1 })
    }
  }
  return bays
}

export function inside(p: Vec2, r: Rect, margin = 0): boolean {
  return p.x >= r.minX - margin && p.x <= r.maxX + margin && p.z >= r.minZ - margin && p.z <= r.maxZ + margin
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
}

/** Pallet footprint. `alongX` = length along X (POU and staging pallets). */
export function palletRect(c: Vec2, alongX = false): Rect {
  const [hx, hz] = alongX ? [PALLET.length / 2, PALLET.width / 2] : [PALLET.width / 2, PALLET.length / 2]
  return { minX: c.x - hx, maxX: c.x + hx, minZ: c.z - hz, maxZ: c.z + hz }
}

export function rackFootprint(c: Vec2): Rect {
  return { minX: c.x - SERVER_RACK.depth / 2, maxX: c.x + SERVER_RACK.depth / 2, minZ: c.z - SERVER_RACK.width / 2, maxZ: c.z + SERVER_RACK.width / 2 }
}

function buildLayout(): FactoryLayout {
  const { aisles, slots, kanbanArea, middleAisle } = buildKanban()
  const stations = buildStations()
  const rackingBays = buildRacking()

  const lineStations = stations.filter((s) => s.id !== 'SUBASSY')
  const lastZ = lineStations[lineStations.length - 1].rack.z
  const botZ = kanbanArea.maxZ + 1.5
  const lineBotZ = lastZ + 2.2
  const R = ROUTES

  // CLS bays sit between the spine and the POU lane on the top corridor: the hub every trip passes.
  // Bays are 3.5 m deep so a parked handler's operator stays clear of the corridor, including
  // the operator of a handler cutting the spine or POU-lane corner.
  const parkingSpots: ParkingSpot[] = [
    ...[36.4, 38.6, 40.8].map((x) => ({ x, z: R.topZ - 3.5, role: 'CLS' as const, junction: { x, z: R.topZ } })),
    ...[0, 1].map((i) => {
      const z = STAGING.firstZ + (STAGING.slots + 1 + i) * STAGING.pitch
      return { x: STAGING.x, z, role: 'DSV' as const, junction: { x: R.dsvAisleX, z } }
    }),
  ]

  const corridors: Corridor[] = [
    { id: 'dsv-aisle', a: { x: R.dsvAisleX, z: R.topZ }, b: { x: R.dsvAisleX, z: botZ } },
    { id: 'cls-aisle', a: { x: R.clsAisleX, z: R.topZ }, b: { x: R.clsAisleX, z: botZ } },
    ...aisles.map((a) => ({ id: `aisle-${a.id}`, a: { x: R.dsvAisleX, z: a.z }, b: { x: R.clsAisleX, z: a.z } })),
    { id: 'top', a: { x: R.dsvAisleX, z: R.topZ }, b: { x: R.pouLaneX, z: R.topZ } },
    { id: 'bottom', a: { x: R.dsvAisleX, z: botZ }, b: { x: R.spineX, z: botZ } },
    { id: 'spine', a: { x: R.spineX, z: R.topZ }, b: { x: R.spineX, z: lineBotZ } },
    { id: 'pou-lane', a: { x: R.pouLaneX, z: R.topZ }, b: { x: R.pouLaneX, z: lineBotZ } },
    { id: 'line-end', a: { x: R.spineX, z: lineBotZ }, b: { x: R.pouLaneX, z: lineBotZ } },
  ]

  const zones = {
    dsvRacking: ZONES.dsvRacking,
    dsvStaging: ZONES.dsvStaging,
    handlerFloor: ZONES.handlerFloor,
    finishedStaging: ZONES.finishedStaging,
    mainAisle: ZONES.mainAisle,
    dsvDrop: { ...AISLES.dsvDrop, minZ: R.topZ - 0.9, maxZ: botZ + 0.9 },
    clsPick: { ...AISLES.clsPick, minZ: R.topZ - 0.9, maxZ: botZ + 0.9 },
  }

  const lineStops = lineStations.map((s) => s.rack)
  const C = CONVEYOR
  const turnZ = lastZ + C.turnDz
  const half = C.bedWidth / 2
  const conveyor: Conveyor = {
    stops: lineStops,
    load: { x: lineStops[0].x, z: lineStops[0].z - C.loadDz },
    outfeed: [lineStops[lineStops.length - 1], { x: LINE.rackX, z: turnZ }, { x: C.outfeedX, z: turnZ }, { x: C.outfeedX, z: C.endZ }],
    stagingLane: [{ x: C.outfeedX, z: C.endZ }, { x: C.outfeedX, z: C.laneTurnZ }, { x: C.laneX, z: C.laneTurnZ }, { x: C.laneX, z: C.laneZ }],
    laneZ: C.laneZ,
    bedHeight: C.bedHeight,
    rects: [
      { minX: LINE.rackX - half, maxX: LINE.rackX + half, minZ: lineStops[0].z - C.loadDz - 0.45, maxZ: turnZ + 0.45 },
      { minX: LINE.rackX - half, maxX: C.outfeedX + half, minZ: turnZ - 0.45, maxZ: turnZ + 0.45 },
      { minX: C.outfeedX - half, maxX: C.outfeedX + half, minZ: C.endZ, maxZ: turnZ + 0.45 },
    ],
  }
  // Worker A on the POU side, worker B between the rack and the bench; both face the rack.
  const workers: WorkerSpot[] = lineStations.flatMap((s) => [
    { id: `${s.id}-A`, station: s.id, side: 'A' as const, x: s.rack.x - WORKER.sideA, z: s.rack.z + WORKER.stagger, yaw: Math.PI / 2 },
    { id: `${s.id}-B`, station: s.id, side: 'B' as const, x: s.rack.x + WORKER.sideB, z: s.rack.z - WORKER.stagger, yaw: -Math.PI / 2 },
  ])

  const lineRect: Rect = { minX: LINE.pouX - 1, maxX: LINE.rackX + LINE.benchOffsetX + 1, minZ: lineStops[0].z - lineStations[0].span / 2 - 2.5, maxZ: lastZ + 4.5 }
  const subassy = stations.find((s) => s.id === 'SUBASSY')!
  const corridorRects = corridors.map(({ a, b }) => ({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) }))

  // Columns on a regular grid, dropped where they would land in storage, the line or a corridor.
  // The real column grid is unknown; this keeps the scene free of impossible overlaps.
  const blocked: Rect[] = [
    { ...kanbanArea, minX: zones.dsvDrop.minX, maxX: zones.clsPick.maxX },
    { ...zones.dsvRacking, minX: zones.dsvRacking.minX - 2 },
    zones.dsvStaging, lineRect, zones.mainAisle, zones.finishedStaging, ...conveyor.rects,
    { minX: subassy.pou[0].x - 1, maxX: subassy.rack.x + 1.5, minZ: subassy.rack.z - 3, maxZ: subassy.rack.z + 3.5 },
    ...parkingSpots.map((p) => ({ minX: p.x - 1.5, maxX: p.x + 1.5, minZ: Math.min(p.z, p.junction.z) - 1.5, maxZ: Math.max(p.z, p.junction.z) + 1.5 })),
  ]
  // Keep the Kanban board, 2-bin shelving and carts clear of columns too.
  const board = { x: ZONES.handlerFloor.minX + 1.5, z: 12 }
  blocked.push({ minX: board.x - 0.6, maxX: board.x + 0.6, minZ: board.z - 2.2, maxZ: board.z + 2.2 })
  const columns: Vec2[] = []
  for (let x = BUILDING.minX + 4; x < BUILDING.maxX - 1; x += BUILDING.columnPitchX) {
    for (let z = BUILDING.minZ + 7.5; z < BUILDING.maxZ - 1; z += BUILDING.columnPitchZ) {
      const p = { x, z }
      if (!blocked.some((r) => inside(p, r, 0.6)) && !corridorRects.some((r) => inside(p, r, 1.4))) columns.push(p)
    }
  }

  // Finished racks: the green 2 x 5 block in the top-right box of P1.
  const fs = zones.finishedStaging
  const finishedRackSpots: Vec2[] = []
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) finishedRackSpots.push({ x: fs.minX + 4 + c * 1.6, z: fs.minZ + 2.2 + r * 2.2 })
  }

  return {
    building: { minX: BUILDING.minX, maxX: BUILDING.maxX, minZ: BUILDING.minZ, maxZ: BUILDING.maxZ },
    kanbanArea, aisles, middleAisle, slots, stations, rackingBays, columns, corridors, zones, finishedRackSpots,
    stagingSlots: Array.from({ length: STAGING.slots }, (_, i) => ({ x: STAGING.x, z: STAGING.firstZ + i * STAGING.pitch })),
    parkingSpots,
    smallPartsRacks: [{ x: LINE.rackX - 1.5, z: lastZ + 5 }, { x: LINE.rackX + 1.5, z: lastZ + 5 }],
    kanbanBoard: board,
    carts: [0, 1].map((i) => ({ x: R.spineX - 4 + i * 2.2, z: lastZ + 5 })),
    conveyor,
    workers,
  }
}

export const LAYOUT: FactoryLayout = buildLayout()

/** Display name for a station id ("ST1" → "Station 1 · Chassis"); unknown ids pass through. */
export const stationLabel = (id: string) => LAYOUT.stations.find((s) => s.id === id)?.label ?? id
