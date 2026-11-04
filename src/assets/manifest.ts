import type { Confidence, KanbanPart } from '../data/parts'
import { PALLET, RACKING, SERVER_RACK } from '../layout/constants'
import type { GeoBuilder } from './geometry/builder'
import { buildBench, buildCart, buildColumn, buildKanbanBoard, buildPalletJack, buildTwoBinShelving } from './geometry/equipment'
import { buildCartonStack, buildCrate, buildWrappedRack } from './geometry/loads'
import { buildPallet } from './geometry/pallet'
import { buildRackingBay, buildUprightFrame } from './geometry/racking'
import { buildRackFrame } from './geometry/serverRack'

export type AssetId =
  | 'pallet' | 'cartonStack' | 'crate' | 'wrappedRack' | 'rackFrame' | 'rackingBay' | 'uprightFrame'
  | 'bench' | 'palletJack' | 'cart' | 'twoBinShelving' | 'kanbanBoard' | 'column'

export interface AssetEntry {
  id: AssetId
  name: string
  /** Path under /public. When set, the GLB replaces the procedural model if it loads and passes the scale check. */
  glb: string | null
  build: () => GeoBuilder
  /** Expected bounding box in metres (x, y, z) used to validate a GLB's scale. */
  dims: [number, number, number]
  /** Height of the lowest geometry above the origin, for parts that start above the floor (default 0). */
  floorOffset?: number
  confidence: Confidence
  geometry: 'procedural-approximate' | 'cad'
  basis: string
  license: string
  partNumbers?: string[]
}

const ORIGINAL = 'Original procedural model (this project)'

// A racking bay is beams and decks only (uprights are separate): it spans the first beam's
// underside to the top deck, not floor to top.
const BAY_BOTTOM = RACKING.levels[1] - 0.12
const BAY_TOP = RACKING.levels[RACKING.levels.length - 1] + 0.012

export const ASSETS: Record<AssetId, AssetEntry> = {
  pallet: { id: 'pallet', name: 'GMA 48x40 stringer pallet', glb: null, build: buildPallet, dims: [PALLET.width, PALLET.height, PALLET.length], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'North American standard pallet; pallet type not stated in sources', license: ORIGINAL },
  cartonStack: { id: 'cartonStack', name: 'Wrapped carton load (per metre height)', glb: null, build: buildCartonStack, dims: [PALLET.width, 1, PALLET.length], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Load height per part estimated; footprint = pallet', license: ORIGINAL },
  crate: { id: 'crate', name: 'Plywood crate (per metre height)', glb: null, build: buildCrate, dims: [PALLET.width, 1, PALLET.length], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Used for busbars, rails, plates, brackets', license: ORIGINAL },
  wrappedRack: { id: 'wrappedRack', name: 'Base rack, wrapped on pallet', glb: null, build: buildWrappedRack, dims: [SERVER_RACK.width, SERVER_RACK.height, SERVER_RACK.depth], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Sheet: 1 rack per pallet (verified). Rack size typical GPU rack, not from evidence', license: ORIGINAL, partNumbers: ['1225629'] },
  rackFrame: { id: 'rackFrame', name: 'GPU rack frame', glb: null, build: () => buildRackFrame(), dims: [SERVER_RACK.width, SERVER_RACK.height, SERVER_RACK.depth], confidence: 'estimated', geometry: 'procedural-approximate', basis: '600 x 1200 x 2286 mm (48U) assumed; replace with CAD when available', license: ORIGINAL, partNumbers: ['1225629'] },
  rackingBay: { id: 'rackingBay', name: 'Selective racking bay (beams + decks)', glb: null, build: buildRackingBay, dims: [RACKING.depth, BAY_TOP - BAY_BOTTOM, RACKING.bayWidth], floorOffset: BAY_BOTTOM, confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Photos show high-bay racking; sizes are typical', license: ORIGINAL },
  uprightFrame: { id: 'uprightFrame', name: 'Racking upright frame', glb: null, build: buildUprightFrame, dims: [RACKING.depth, RACKING.height, 0.14], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Typical teardrop upright', license: ORIGINAL },
  bench: { id: 'bench', name: 'Assembly bench', glb: null, build: buildBench, dims: [0.75, 1.9, 1.8], confidence: 'placeholder', geometry: 'procedural-approximate', basis: 'Station furniture not visible in sources', license: ORIGINAL },
  palletJack: { id: 'palletJack', name: 'Manual pallet jack', glb: null, build: buildPalletJack, dims: [0.69, 1.2, 1.3], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Slide P1: material moved one pallet at a time by handler', license: ORIGINAL },
  cart: { id: 'cart', name: 'Platform cart', glb: null, build: buildCart, dims: [0.8, 1.05, 1.4], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Illustrative; cart type not in sources', license: ORIGINAL },
  twoBinShelving: { id: 'twoBinShelving', name: '2-bin small-parts shelving', glb: null, build: buildTwoBinShelving, dims: [1.8, 1.9, 0.6], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Slide P4: 2-bin system for screws, nuts, bolts; labelled bins next to line', license: ORIGINAL },
  kanbanBoard: { id: 'kanbanBoard', name: 'Kanban board', glb: null, build: buildKanbanBoard, dims: [0.6, 2.15, 3.65], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Slide P2: today row in 2 h slots + weekday calendar; 12 + 7 pockets counted', license: ORIGINAL },
  column: { id: 'column', name: 'Building column with guard', glb: null, build: buildColumn, dims: [0.54, 10, 0.54], confidence: 'estimated', geometry: 'procedural-approximate', basis: 'Column grid unknown; 12 x 15 m assumed', license: ORIGINAL },
}

export const SCALE_TOLERANCE = 0.25

/**
 * Checks a model's bounding box against the manifest: size per axis within tolerance (catches cm/mm
 * exports and wrong up-axis) and origin on the floor. Returns the reason it fails, or null.
 */
export function validateBounds(id: AssetId, size: [number, number, number], minY: number): string | null {
  const expected = ASSETS[id].dims
  const bad = size.findIndex((s, i) => Math.abs(s - expected[i]) / expected[i] > SCALE_TOLERANCE)
  if (bad >= 0) return `size ${size.map((s) => s.toFixed(2)).join(' x ')} m does not match expected ${expected.join(' x ')} m (axis ${'xyz'[bad]})`
  const floor = ASSETS[id].floorOffset ?? 0
  if (minY < floor - 0.01 || minY > floor + 0.05) return `origin not at floor (min y = ${minY.toFixed(3)}, expected ${floor.toFixed(3)})`
  return null
}

export type LoadKind = 'rack' | 'carton' | 'crate'
export interface LoadProfile { kind: LoadKind; height: number; confidence: Confidence }

/** Load shape and height on a pallet. All heights are estimates: only pallet counts are in the sheet. */
export function loadProfile(part: Pick<KanbanPart, 'description'>): LoadProfile {
  const d = part.description.toLowerCase()
  if (d.includes('base rack')) return { kind: 'rack', height: SERVER_RACK.height, confidence: 'estimated' }
  if (d.includes('shel')) return { kind: 'carton', height: 1.1, confidence: 'estimated' }
  if (d.includes('busbar')) return { kind: 'crate', height: 0.55, confidence: 'estimated' }
  if (d.includes('rail')) return { kind: 'crate', height: 0.5, confidence: 'estimated' }
  if (d.includes('cable manager')) return { kind: 'carton', height: 0.9, confidence: 'estimated' }
  if (d.includes('drain')) return { kind: 'carton', height: 1.2, confidence: 'estimated' }
  if (d.includes('water pan')) return { kind: 'carton', height: 1.0, confidence: 'estimated' }
  if (d.includes('adapter') || d.includes('bracket')) return { kind: 'crate', height: 0.42, confidence: 'estimated' }
  return { kind: 'carton', height: 0.8, confidence: 'estimated' }
}
