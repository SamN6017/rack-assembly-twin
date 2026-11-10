import extraction from '../../data/factory-extraction.json'
import { loadProfile, type AssetId, type LoadProfile } from '../assets/manifest'
import { LAYOUT } from '../layout/factoryLayout'
import { KANBAN_PARTS, stationOfStep, type Confidence, type KanbanPart } from './parts'

/**
 * One record per stocked part: the fields the brief asks every component to carry. Physical part
 * dimensions are not in any source, so the 3D shape is the packaged load on its pallet.
 */
export interface ComponentRecord {
  id: string
  part: KanbanPart
  load: LoadProfile
  asset: AssetId
  appearance: string
  storageSlots: string[]
  pouDestination: { station: string; x: number; z: number } | null
  inventory: {
    /** Pieces per Kanban when full (pallets x qty per pallet). */
    perKanban: number | null
    /** Both Kanbans full + 1 POU pallet: the V1 starting assumption ("all Kanbans full", slide P1). */
    initialKanbanStock: number | null
    initialPouStock: number | null
    unit: 'pieces'
    confidence: Confidence
  }
  partDimensions: null
  geometryConfidence: 'procedural-approximate'
}

const LOAD_TEXT: Record<LoadProfile['kind'], string> = {
  rack: 'Rack frame on pallet, stretch wrapped',
  carton: 'Carton stack on pallet, stretch wrapped',
  crate: 'Plywood crate on pallet',
}
const LOAD_ASSET: Record<LoadProfile['kind'], AssetId> = { rack: 'wrappedRack', carton: 'cartonStack', crate: 'crate' }

function buildRecord(part: KanbanPart): ComponentRecord {
  const load = loadProfile(part)
  const pou = LAYOUT.stations.flatMap((s) => s.pou.filter((p) => p.pn === part.pn).map((p) => ({ station: s.id, x: p.x, z: p.z })))[0] ?? null
  const perKanban = part.qtyPerPallet !== null ? part.kanbanPallets * part.qtyPerPallet : null
  return {
    id: `CMP-${part.pn}`,
    part,
    load,
    asset: LOAD_ASSET[load.kind],
    appearance: `${LOAD_TEXT[load.kind]}, ~${load.height.toFixed(2)} m load`,
    storageSlots: LAYOUT.slots.filter((s) => s.pn === part.pn).map((s) => s.id),
    pouDestination: pou,
    inventory: {
      perKanban,
      initialKanbanStock: perKanban !== null ? perKanban * 2 : null,
      initialPouStock: pou && part.qtyPerPallet !== null ? part.qtyPerPallet : null,
      unit: 'pieces',
      confidence: perKanban !== null ? 'estimated' : 'placeholder',
    },
    partDimensions: null,
    geometryConfidence: 'procedural-approximate',
  }
}

export const COMPONENTS = new Map(KANBAN_PARTS.map((p) => [p.pn, buildRecord(p)]))

export interface SmallPart { pn: string; description: string; workstation: string; station: string | null; qtyPerRack: number | 'roll' }

export const SMALL_PARTS: SmallPart[] = extraction.small_parts_2bin.items.map((s) => ({
  pn: s.pn,
  description: s.description,
  workstation: s.workstation,
  station: stationOfStep(s.workstation),
  qtyPerRack: s.qty_per_rack as number | 'roll',
}))

/** Parts consumed at a station (ST1 … ST5 or SUBASSY): pallet Kanban parts staged there, plus 2-bin small parts. */
export function stationParts(stationId: string) {
  const kanban = KANBAN_PARTS.filter((p) => p.station === stationId)
  const small = SMALL_PARTS.filter((s) => s.station === stationId)
  return { kanban, small }
}
