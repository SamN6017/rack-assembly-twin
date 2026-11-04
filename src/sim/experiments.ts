import { getPart, KANBAN_PARTS } from '../data/parts'
import { isTracked, MAX_HANDLERS, type MovementConfig } from './movementSim'

export type ExperimentId = 'A' | 'B' | 'C' | 'D' | 'E'

export interface Variant { name: string; config: MovementConfig }

export interface ExperimentDef {
  id: ExperimentId
  title: string
  question: string
  /** Whether the experiment acts on the user's focus parts. */
  usesFocus: boolean
  variants: (base: MovementConfig, focus: string[]) => Variant[]
}

/** Default focus parts: the tracked parts whose Kanban lasts the fewest hours (from the sheet). */
export const DEFAULT_FOCUS = KANBAN_PARTS.filter(isTracked)
  .sort((a, b) => a.hoursPerKanban - b.hoursPerKanban || a.pn.localeCompare(b.pn))
  .slice(0, 4)
  .map((p) => p.pn)

const stockAt = (base: MovementConfig, focus: string[], share: { kanban?: number; pou?: number }) => {
  const stock = { ...base.stock }
  for (const pn of focus) stock[pn] = { ...stock[pn], ...share }
  return stock
}

/** What-if experiments A–E from the brief. Every variant runs through the same simulation. */
export const EXPERIMENTS: ExperimentDef[] = [
  {
    id: 'A', title: 'Production scaling', usesFocus: false,
    question: 'Which parts become constrained, and when, at 5, 6, 8 and 10 racks/h?',
    variants: (base) => [5, 6, 8, 10].map((r) => ({ name: `${r} racks/h`, config: { ...base, ratePerHour: r } })),
  },
  {
    id: 'B', title: 'Kanban quantity', usesFocus: true,
    question: 'Two versus three Kanbans for the focus parts: extra inventory and effect on stoppages.',
    variants: (base, focus) => [
      { name: '2 Kanbans', config: { ...base, extraKanbanPns: base.extraKanbanPns.filter((pn) => !focus.includes(pn)) } },
      { name: '3 Kanbans (focus)', config: { ...base, extraKanbanPns: [...new Set([...base.extraKanbanPns, ...focus])] } },
    ],
  },
  {
    id: 'C', title: 'Replenishment frequency', usesFocus: false,
    question: 'Board checked every 30, 60 or 120 min: stockouts, pending requests, handling workload.',
    variants: (base) => [30, 60, 120].map((m) => ({ name: `Every ${m} min`, config: { ...base, inspectionIntervalMin: m } })),
  },
  {
    id: 'D', title: 'Material handler capacity', usesFocus: false,
    question: 'Staffing levels: task queue times and delivery delays.',
    variants: (base) => {
      const out: Variant[] = []
      for (let dsv = 1; dsv <= MAX_HANDLERS.DSV; dsv++)
        for (let cls = 1; cls <= MAX_HANDLERS.CLS; cls++)
          out.push({ name: `${cls} CLS + ${dsv} DSV`, config: { ...base, clsHandlers: cls, dsvHandlers: dsv } })
      return out
    },
  },
  {
    id: 'E', title: 'Initial inventory', usesFocus: true,
    question: 'Starting stock of the focus parts raised or cut: coverage and feasible output.',
    variants: (base, focus) => [
      { name: 'Kanbans 25%', config: { ...base, stock: stockAt(base, focus, { kanban: 0.25 }) } },
      { name: 'Kanbans 50%', config: { ...base, stock: stockAt(base, focus, { kanban: 0.5 }) } },
      { name: 'As configured', config: base },
      { name: 'Full POU pallets', config: { ...base, stock: stockAt(base, focus, { pou: 1 }) } },
    ],
  },
]

export const focusLabel = (focus: string[]) => focus.map((pn) => `${getPart(pn).description} ${pn}`).join(', ')
