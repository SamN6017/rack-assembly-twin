import type { InventorySnapshot, KanbanState, MovementResult } from './movementSim'
import { cycleAt } from './movementSim'

/**
 * Where each Kanban card sits on the physical board (slide P2: a "today" row of 12 two-hour
 * pockets and a row of 7 below). Derived from the digital card states only; there is no separate
 * board state. Cards out on the replenishment loop go in the today pocket of their due time;
 * refilled cards waiting to be filed at the next inspection go in the lower row.
 */
export interface BoardCard { slotId: string; state: KanbanState; row: 'today' | 'filed'; pocket: number; stack: number; dueAt: number | null }

const ON_LOOP = new Set<KanbanState>(['EMPTY', 'REQUESTED', 'PREPARING', 'IN_TRANSIT'])
export const TODAY_POCKETS = 12
export const FILED_POCKETS = 7

export function boardCards(result: MovementResult, snapshot: InventorySnapshot, t: number): BoardCard[] {
  const out: BoardCard[] = []
  const stacks = new Map<string, number>()
  const place = (row: BoardCard['row'], pocket: number) => {
    const k = `${row}:${pocket}`
    const n = stacks.get(k) ?? 0
    stacks.set(k, n + 1)
    return n
  }
  const ids = [...snapshot.cards.keys()].sort()
  let filed = 0
  for (const slotId of ids) {
    const card = snapshot.cards.get(slotId)!
    if (ON_LOOP.has(card.state)) {
      const due = cycleAt(result, slotId, t)?.dueAt ?? t
      const pocket = Math.floor((((due % 86400) + 86400) % 86400) / 7200) % TODAY_POCKETS
      out.push({ slotId, state: card.state, row: 'today', pocket, stack: place('today', pocket), dueAt: due })
    } else if (card.state === 'REPLENISHED') {
      const pocket = filed++ % FILED_POCKETS
      out.push({ slotId, state: card.state, row: 'filed', pocket, stack: place('filed', pocket), dueAt: null })
    }
  }
  return out
}
