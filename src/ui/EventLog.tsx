import { useMemo, useState } from 'react'
import { eventLog, type LogType } from '../sim/kpis'
import { formatClock, useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { useSimTime } from './useSimTime'

/** Event families the log can be filtered to. Consumption is off by default: one row per station per rack. */
const GROUPS: { id: string; label: string; types: LogType[]; on: boolean }[] = [
  { id: 'line', label: 'Line', types: ['PRODUCTION_REQUESTED', 'RACK_COMPLETED', 'PRODUCTION_BLOCKED', 'PRODUCTION_RESUMED'], on: true },
  { id: 'kanban', label: 'Kanban', types: ['KANBAN_EMPTY', 'REPLENISHMENT_REQUESTED', 'REPLENISHMENT_PREPARED', 'KANBAN_REPLENISHED', 'BOARD_INSPECTION'], on: true },
  { id: 'handling', label: 'Handling', types: ['MATERIAL_ALLOCATED', 'HANDLER_DISPATCHED', 'HANDLER_ARRIVED', 'MATERIAL_DELIVERED'], on: true },
  { id: 'consumed', label: 'Consumption', types: ['MATERIAL_CONSUMED'], on: false },
]

const TONE: Partial<Record<LogType, string>> = {
  PRODUCTION_BLOCKED: 'text-red-300', PRODUCTION_RESUMED: 'text-emerald-300', RACK_COMPLETED: 'text-emerald-300',
  KANBAN_EMPTY: 'text-red-300', REPLENISHMENT_REQUESTED: 'text-orange-300', REPLENISHMENT_PREPARED: 'text-yellow-300',
  KANBAN_REPLENISHED: 'text-teal-300', MATERIAL_DELIVERED: 'text-sky-300',
}

/** Simulation event log up to the current clock, newest first. Click a row to locate what it refers to. */
export function EventLog() {
  const t = useSimTime(500)
  const result = useSim((s) => s.result)
  const select = useUi((s) => s.select)
  const [on, setOn] = useState(() => new Set(GROUPS.filter((g) => g.on).map((g) => g.id)))
  const all = useMemo(() => eventLog(result), [result])
  const types = useMemo(() => new Set(GROUPS.filter((g) => on.has(g.id)).flatMap((g) => g.types)), [on])
  const rows: typeof all = []
  // Walk back from the clock; stop once the table is full.
  for (let i = all.length - 1; i >= 0 && rows.length < 150; i--) if (all[i].t <= t && types.has(all[i].type)) rows.push(all[i])
  const toggle = (id: string) => setOn((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 px-3 py-1">
        {GROUPS.map((g) => (
          <button key={g.id} onClick={() => toggle(g.id)} className={`rounded px-1.5 py-px text-[10px] ring-1 ${on.has(g.id) ? 'bg-sky-500/15 text-sky-200 ring-sky-500/40' : 'text-neutral-500 ring-white/10'}`}>{g.label}</button>
        ))}
        <span className="ml-auto text-[10px] text-neutral-500">{all.filter((e) => e.t <= t).length.toLocaleString()} events so far · showing latest {rows.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-[12px]">
          <tbody className="font-mono">
            {rows.map((e, i) => (
              <tr key={`${e.t}-${i}`} onClick={() => e.entity && select(e.entity, { focus: true })} className={`border-t border-white/[0.04] ${e.entity ? 'cursor-pointer hover:bg-white/[0.03]' : ''}`}>
                <td className="w-20 px-3 py-0.5 text-neutral-400">{formatClock(e.t)}</td>
                <td className={`w-56 px-3 py-0.5 text-[11px] ${TONE[e.type] ?? 'text-neutral-300'}`}>{e.type}</td>
                <td className="px-3 py-0.5 font-sans text-neutral-300">{e.text}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-3 py-3 font-sans text-neutral-500">No events yet. Press Start in the Simulation panel.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
