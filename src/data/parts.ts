import extraction from '../../data/factory-extraction.json'

export type Confidence = 'verified' | 'estimated' | 'placeholder'
export type Model = 'Yawn' | 'Bloom'

export interface KanbanPart {
  pn: string
  altPn?: string
  description: string
  models: Model[]
  /** The sheet's workstation column: an assembly step (WS1 … WS10, SUBASSY), as written. */
  workstation: string | null
  /** Physical line station that fits the part (ST1 … ST5, or SUBASSY), from line_stations. */
  station: string | null
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

/** A physical station on the assembly line, as the user described it (names verified, step mapping estimated). */
export interface LineStationDef { id: string; name: string; steps: string[]; confidence: Confidence; note?: string }
export const LINE_STATION_DEFS: LineStationDef[] = extraction.line_stations.items.map((s) => ({
  id: s.id, name: s.name, steps: s.steps, confidence: s.confidence as Confidence, note: 'note' in s ? s.note : undefined,
}))

/**
 * Station for a sheet step ("WS3", "WS7 & WS8", "WS7/WS8", "SUBASSY"). Shared steps resolve to the
 * first step's station. Sub-assembly stays its own area off the line.
 */
export function stationOfStep(step: string | null): string | null {
  if (!step) return null
  const first = step.split(/[&/]/)[0].trim()
  if (first === 'SUBASSY') return 'SUBASSY'
  return LINE_STATION_DEFS.find((s) => s.steps.includes(first))?.id ?? null
}

// Rows without a part number cannot be stocked or tracked, so they stay in the JSON only.
export const KANBAN_PARTS: KanbanPart[] = raw
  .filter((p): p is RawPart & { pn: string } => p.pn !== null)
  .map((p) => ({
    pn: p.pn,
    altPn: p.alt_pn,
    description: p.description,
    models: p.models as Model[],
    workstation: p.workstation,
    station: stationOfStep(p.workstation),
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
