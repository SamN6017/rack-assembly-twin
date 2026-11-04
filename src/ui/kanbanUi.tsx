import type { KanbanPart } from '../data/parts'
import { cycleAt, kanbanPieces, type CardCycle, type InventorySnapshot, type KanbanState, type MovementResult } from '../sim/movementSim'
import { useSim } from '../store/simStore'
import { Row, Section } from './common'
import { useSimTime } from './useSimTime'

/** Card colours shared by the board, the details panel and the 3D overlay. */
export const STATE_STYLE: Record<KanbanState, { label: string; hex: string; chip: string }> = {
  FULL: { label: 'Full', hex: '#3b82f6', chip: 'bg-blue-500/15 text-blue-200 ring-blue-500/40' },
  IN_USE: { label: 'In use', hex: '#22c55e', chip: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40' },
  EMPTY: { label: 'Empty', hex: '#ef4444', chip: 'bg-red-500/15 text-red-200 ring-red-500/40' },
  REQUESTED: { label: 'Requested', hex: '#f97316', chip: 'bg-orange-500/15 text-orange-200 ring-orange-500/40' },
  PREPARING: { label: 'Preparing', hex: '#eab308', chip: 'bg-yellow-500/15 text-yellow-200 ring-yellow-500/40' },
  IN_TRANSIT: { label: 'In transit', hex: '#a855f7', chip: 'bg-purple-500/15 text-purple-200 ring-purple-500/40' },
  REPLENISHED: { label: 'Replenished', hex: '#14b8a6', chip: 'bg-teal-500/15 text-teal-200 ring-teal-500/40' },
}

export function StateChip({ state }: { state: KanbanState }) {
  const s = STATE_STYLE[state]
  return <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1 ${s.chip}`}>{s.label}</span>
}

/** Compact duration: 45s, 12m, 1h05. */
export function dur(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}

/** Replenishment progress of a card that is out on the loop at time t, or null when it is not. */
export function openCycle(result: MovementResult, slotId: string, t: number): CardCycle | null {
  const c = cycleAt(result, slotId, t)
  return c && (c.replenishedAt === undefined || c.replenishedAt > t) ? c : null
}

/** Due countdown, or how late a card is. */
export function DueTag({ cycle, t }: { cycle: CardCycle; t: number }) {
  const left = cycle.dueAt - t
  return left >= 0
    ? <span className={`font-mono text-[10px] ${left < 1800 ? 'text-amber-300' : 'text-neutral-400'}`}>due {dur(left)}</span>
    : <span className="font-mono text-[10px] font-semibold text-red-300">late {dur(-left)}</span>
}

export function FillBar({ value, tone }: { value: number; tone: 'ok' | 'low' | 'out' }) {
  const color = tone === 'ok' ? 'bg-emerald-400/80' : tone === 'low' ? 'bg-amber-400/80' : 'bg-red-500/80'
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-white/10 align-middle">
      <span className={`block h-full ${color}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  )
}

/** Live Kanban and point-of-use stock for one part (details panel). */
export function LiveStock({ part, storageSlots, pou, snapshot }: { part: KanbanPart; storageSlots: string[]; pou: string | null; snapshot: InventorySnapshot }) {
  const t = useSimTime(500)
  const result = useSim((s) => s.result)
  const key = pou ? `${pou}:${part.pn}` : null
  const pouPcs = key ? snapshot.pou.get(key) : undefined
  const owed = key ? snapshot.backorder.get(key) ?? 0 : 0
  return (
    <Section title="Live stock">
      {storageSlots.map((sid, i) => {
        const card = snapshot.cards.get(sid)
        const pcs = kanbanPieces(snapshot, sid, part)
        const cyc = openCycle(result, sid, t)
        return (
          <div key={sid} className="border-b border-white/[0.04] py-1.5 last:border-0">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-neutral-400">Kanban #{i + 1}</span>
              {card && <StateChip state={card.state} />}
            </div>
            <div className="mt-0.5 flex items-center justify-between font-mono text-[11px] text-neutral-400">
              <span>{snapshot.kanban.get(sid) ?? 0}/{part.kanbanPallets} pal{pcs !== null ? ` · ${pcs.toLocaleString()} pcs` : ''}</span>
              <span>{card ? `${dur(t - card.since)} in state` : ''}</span>
            </div>
            {cyc && <div className="mt-0.5 flex justify-between text-[10px] text-neutral-500"><span>emptied {dur(t - cyc.emptyAt)} ago</span><DueTag cycle={cyc} t={t} /></div>}
          </div>
        )
      })}
      {key && pouPcs !== undefined && part.qtyPerPallet && part.qtyPerRack && (
        <>
          <Row label={`POU ${pou}`} value={<><FillBar value={pouPcs / part.qtyPerPallet} tone={owed ? 'out' : pouPcs < part.qtyPerRack ? 'low' : 'ok'} /> {pouPcs}/{part.qtyPerPallet}</>} />
          <Row label="Racks covered" value={Math.floor(pouPcs / part.qtyPerRack)} />
          {owed > 0 && <Row label="Starved · pieces owed" value={<span className="text-red-300">{owed}</span>} />}
        </>
      )}
      {(!part.qtyPerPallet || !part.qtyPerRack) && <p className="text-[11px] text-neutral-500">BOM or pallet quantity missing from the sheet, so this part's stock is not simulated.</p>}
    </Section>
  )
}
