import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { getPart, modelTab, type KanbanPart } from '../data/parts'
import { LAYOUT, type KanbanSlot } from '../layout/factoryLayout'
import { resolveEntity } from '../scene/entities'
import { KANBAN_STATES, type CardCycle, type KanbanState } from '../sim/movementSim'
import { formatClock, simClock, useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { ConfidenceBadge } from './common'
import { DueTag, dur, openCycle, STATE_STYLE } from './kanbanUi'
import { useSimTime } from './useSimTime'

const TAB_COLOR = { shared: 'bg-[#f2c218]', bloom: 'bg-[#2e9e4a]', yawn: 'bg-transparent ring-1 ring-neutral-500' }

/** States where the card is off the Kanban and travelling round the replenishment loop. */
const ON_LOOP = new Set<KanbanState>(['EMPTY', 'REQUESTED', 'PREPARING', 'IN_TRANSIT'])

const STATE_HINT: Record<KanbanState, string> = {
  FULL: 'Waiting behind the Kanban in use',
  IN_USE: 'CLS picks POU pallets from here',
  EMPTY: 'Card on the board, waiting for DSV',
  REQUESTED: 'Collected at inspection, queued for prep',
  PREPARING: 'DSV preparing pallets',
  IN_TRANSIT: 'DSV handler refilling the Kanban',
  REPLENISHED: 'Refilled; card filed at next inspection',
}

interface CardView {
  slot: KanbanSlot
  part: KanbanPart
  state: KanbanState
  since: number
  pallets: number
  cycle: CardCycle | null
}

const Card = memo(function Card({ c, t, selected, related, onPick }: { c: CardView; t: number; selected: boolean; related: boolean; onPick: (id: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const hover = useUi((s) => s.hover)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  const late = c.cycle && t > c.cycle.dueAt
  const fill = c.pallets / c.slot.pallets.length
  return (
    <button
      ref={ref}
      data-slot={c.slot.id}
      onClick={() => onPick(c.slot.id)}
      onMouseEnter={() => hover(`kanban:${c.slot.id}:0`)}
      onMouseLeave={() => hover(null)}
      className={`w-full rounded-md bg-[#18191c] px-2 py-1.5 text-left ring-1 transition-shadow ${
        selected ? 'ring-2 ring-sky-400' : late ? 'ring-red-500/60' : related ? 'ring-sky-500/40' : 'ring-white/[0.07] hover:ring-white/20'
      }`}
      style={{ borderLeft: `3px solid ${STATE_STYLE[c.state].hex}` }}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${TAB_COLOR[modelTab(c.part)]}`} />
        <span className="truncate font-mono text-[11px] text-neutral-100">{c.part.pn}</span>
        <span className="ml-auto shrink-0 rounded bg-white/5 px-1 font-mono text-[9px] text-neutral-400">K{c.slot.index + 1}</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-neutral-400" title={c.part.description}>{c.part.description}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="h-1 flex-1 overflow-hidden rounded bg-white/10"><span className="block h-full bg-neutral-300/70" style={{ width: `${fill * 100}%` }} /></span>
        <span className="font-mono text-[10px] text-neutral-400">{c.pallets}/{c.slot.pallets.length}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[10px] text-neutral-500">
        <span>{c.part.station ?? '—'} · {dur(t - c.since)}</span>
        {c.cycle && <DueTag cycle={c.cycle} t={t} />}
      </div>
    </button>
  )
})

/**
 * Digital Kanban board: one card per Kanban (two per part), in a column per state. Clicking a card
 * selects and frames its Kanban in 3D; selecting a pallet in 3D highlights its card here.
 */
export function KanbanBoard() {
  const t = useSimTime(500)
  const { result, snapshot, config } = useSim()
  const select = useUi((s) => s.select)
  const selected = useUi((s) => s.selected)
  const [query, setQuery] = useState('')
  const [lateOnly, setLateOnly] = useState(false)

  // Resolved during render, not in the selector, so the store never sees a fresh object.
  const sel = selected ? resolveEntity(selected) : null
  const selSlot = sel?.slotId ?? null
  const selPn = sel?.pn ?? null

  const cards = useMemo<CardView[]>(() => LAYOUT.slots.map((slot) => {
    const card = snapshot.cards.get(slot.id)
    const state = card?.state ?? 'FULL'
    return {
      slot, part: getPart(slot.pn), state, since: card?.since ?? 0,
      pallets: snapshot.kanban.get(slot.id) ?? 0,
      // The authoritative clock, not the polled one: a seek updates the snapshot before the poll catches up.
      cycle: ON_LOOP.has(state) ? openCycle(result, slot.id, simClock.t) : null,
    }
  }), [snapshot, result])

  const q = query.trim().toLowerCase()
  const shown = cards.filter((c) =>
    (!q || [c.part.pn, c.part.description, c.part.workstation ?? '', c.part.station ?? ''].some((f) => f.toLowerCase().includes(q))) &&
    (!lateOnly || (c.cycle && t > c.cycle.dueAt)),
  )
  const byState = (s: KanbanState) => shown
    .filter((c) => c.state === s)
    .sort((a, b) => (a.cycle && b.cycle ? a.cycle.dueAt - b.cycle.dueAt : a.since - b.since))

  const interval = config.inspectionIntervalMin * 60
  const nextInspection = Math.floor(t / interval + 1) * interval
  const onLoop = cards.filter((c) => ON_LOOP.has(c.state)).length
  const lateNow = cards.filter((c) => c.cycle && t > c.cycle.dueAt).length
  const closed = result.cycles.filter((c) => c.replenishedAt !== undefined && c.replenishedAt <= t)
  const closedLate = closed.filter((c) => c.late).length
  const starved = [...snapshot.backorder.keys()]
  const pick = (slotId: string) => select(`kanban:${slotId}:0`, { focus: true })

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-white/5 px-4 py-2 text-[11px]">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">Kanban board</span>
        <Stat label="Sim time" value={formatClock(t)} />
        <Stat label="Next DSV inspection" value={nextInspection <= result.horizon ? `${formatClock(nextInspection)} (in ${dur(nextInspection - t)})` : '—'} badge="verified" title={`Board checked every ${config.inspectionIntervalMin} min (slide P1: every 1–2 h)`} />
        <Stat label="Cards on loop" value={onLoop} />
        <Stat label="Late now" value={lateNow} tone={lateNow ? 'bad' : undefined} />
        <Stat label="Refilled" value={`${closed.length} (${closedLate} late)`} tone={closedLate ? 'warn' : undefined} title={`Late = refilled more than ${config.leadTimeH} h after the Kanban emptied`} />
        {config.shortage === 'block'
          ? <Stat label="Line" value={snapshot.line.blocked ? `stopped ${dur(t - snapshot.line.since)}` : 'running'} tone={snapshot.line.blocked ? 'bad' : undefined} title={snapshot.line.keys.join(', ')} />
          : <Stat label="Starved POUs" value={starved.length ? starved.join(', ') : 0} tone={starved.length ? 'bad' : undefined} />}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1 text-neutral-400">
            <input type="checkbox" className="accent-sky-500" checked={lateOnly} onChange={() => setLateOnly((v) => !v)} /> late only
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Filter part, description, station…"
            className="w-56 rounded bg-white/[0.04] px-2 py-1 text-[12px] text-neutral-100 ring-1 ring-white/10 placeholder:text-neutral-500 focus:outline-none focus:ring-sky-500/50"
          />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(7,minmax(150px,1fr))] gap-2 overflow-x-auto p-2">
        {KANBAN_STATES.map((s) => {
          const col = byState(s)
          return (
            <div key={s} className="flex min-h-0 flex-col rounded-md bg-white/[0.02] ring-1 ring-white/5">
              <div className="border-b border-white/5 px-2 py-1.5" title={STATE_HINT[s]}>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: STATE_STYLE[s].hex }} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">{STATE_STYLE[s].label}</span>
                  <span className="ml-auto font-mono text-[11px] text-neutral-500">{col.length}</span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-neutral-500">{STATE_HINT[s]}</div>
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5">
                {col.map((c) => (
                  <Card key={c.slot.id} c={c} t={c.cycle || ON_LOOP.has(c.state) ? t : Math.floor(t / 60) * 60} selected={c.slot.id === selSlot} related={c.slot.id !== selSlot && c.part.pn === selPn} onPick={pick} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <p className="border-t border-white/5 px-4 py-1 text-[10px] text-neutral-500">
        Inspection interval and 2 h lead time are verified; DSV prep ({config.dsvPrepMin} min × {config.dsvPrepTeams} teams), handler speeds and the {Math.round(config.bloomShare * 100)}% Bloom mix are placeholders. Cards start with Kanban #1 in use and #2 full (slide P1).
      </p>
    </div>
  )
}

function Stat({ label, value, tone, badge, title }: { label: string; value: React.ReactNode; tone?: 'bad' | 'warn'; badge?: 'verified'; title?: string }) {
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <span className="text-neutral-500">{label}</span>
      <span className={`font-mono ${tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-neutral-200'}`}>{value}</span>
      {badge && <ConfidenceBadge value={badge} />}
    </span>
  )
}
