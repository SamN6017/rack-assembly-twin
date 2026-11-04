import extraction from '../../data/factory-extraction.json'

export type Confidence = 'verified' | 'estimated' | 'placeholder'
export type Model = 'Yawn' | 'Bloom'

export interface KanbanPart {
  pn: string
  altPn?: string
  description: string
  models: Model[]
  workstation: string | null
  qtyPerRack: number | null
  qtyPerPallet: number | null
  kanbanPallets: number
  hoursPerKanban: number
  supplier?: string
  confidence: Confidence
  pnConfidence: Confidence
}

interface RawPart {
  pn: string | null
  alt_pn?: string
  pn_conf?: string
  description: string
  models: string[]
  workstation: string | null
  qty_per_rack: number | null
  qty_per_pallet: number | null
  kanban_pallets: number
  hours_per_kanban: number
  supplier?: string
  confidence: string
}

const raw = extraction.kanban_parts.items as RawPart[]

// Rows without a part number cannot be stocked or tracked, so they stay in the JSON only.
export const KANBAN_PARTS: KanbanPart[] = raw
  .filter((p): p is RawPart & { pn: string } => p.pn !== null)
  .map((p) => ({
    pn: p.pn,
    altPn: p.alt_pn,
    description: p.description,
    models: p.models as Model[],
    workstation: p.workstation,
    qtyPerRack: p.qty_per_rack,
    qtyPerPallet: p.qty_per_pallet,
    kanbanPallets: p.kanban_pallets,
    hoursPerKanban: p.hours_per_kanban,
    supplier: p.supplier,
    confidence: p.confidence as Confidence,
    pnConfidence: (p.pn_conf as Confidence | undefined) ?? 'estimated',
  }))

export const PART_BY_PN = new Map(KANBAN_PARTS.map((p) => [p.pn, p]))

export function getPart(pn: string): KanbanPart {
  const part = PART_BY_PN.get(pn)
  if (!part) throw new Error(`Unknown part number ${pn}`)
  return part
}

export const PLANNING_BASIS = {
  dailyDemandRacks: extraction.planning_basis.daily_demand_racks.value,
  hoursPerDay: extraction.planning_basis.production_hours_per_day.value,
  sheetRatePerHour: extraction.planning_basis.effective_rate_racks_per_hour.value,
  baselineRatePerHour: extraction.planning_basis.slide_stated_rate_racks_per_hour.value,
  kanbansPerPart: extraction.planning_basis.kanbans_per_part.value,
  leadTimeHours: extraction.planning_basis.replenishment_lead_time_days.hours,
  safetyStockHours: extraction.planning_basis.safety_stock_days.hours,
}

/** Shared = both models (yellow tab), Bloom-only = green tab, Yawn-only = no tab. Verified on slide P3. */
export function modelTab(part: KanbanPart): 'shared' | 'bloom' | 'yawn' {
  if (part.models.length > 1) return 'shared'
  return part.models[0] === 'Bloom' ? 'bloom' : 'yawn'
}
