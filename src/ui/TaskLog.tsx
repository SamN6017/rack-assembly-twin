import { getPart } from '../data/parts'
import { formatClock, useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { useSimTime } from './useSimTime'

const place = (dwell: string) => dwell.replace(/^kp:/, 'Kanban ').replace(/^pou:/, 'POU ').replace(/^stage:/, 'Staging ').replace(/:\d+$/, '').replace(/:/, ' · ')

/** Handler trips up to the current simulation time, newest first. */
export function TaskLog() {
  const t = useSimTime(500)
  const tasks = useSim((s) => s.result.tasks)
  const select = useUi((s) => s.select)
  const rows = tasks.filter((x) => x.requestedAt <= t).slice(-80).reverse()

  return (
    <table className="w-full text-left text-[12px]">
      <thead className="sticky top-0 bg-[#111214] text-[10px] uppercase tracking-wider text-neutral-500">
        <tr>{['Task', 'Requested', 'Handler', 'Type', 'Part', 'From', 'To', 'Picked', 'Delivered', 'Wait', 'Status'].map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr>
      </thead>
      <tbody className="font-mono">
        {rows.map((x) => {
          const status = x.doneAt <= t ? 'done' : x.deliveredAt <= t ? 'returning' : x.pickAt <= t ? 'in transit' : x.departAt <= t ? 'to pick' : 'waiting'
          const color = status === 'done' ? 'text-neutral-500' : status === 'waiting' ? 'text-amber-300' : 'text-sky-300'
          return (
            <tr key={x.id} onClick={() => select(`handler:${x.handler}`)} className="cursor-pointer border-t border-white/[0.04] hover:bg-white/[0.03]">
              <td className="px-3 py-1 text-neutral-300">{x.id}</td>
              <td className="px-3 py-1">{formatClock(x.requestedAt)}</td>
              <td className="px-3 py-1 text-amber-200">{x.handler}</td>
              <td className="px-3 py-1 font-sans text-neutral-300">{x.kind === 'pou-delivery' ? 'POU delivery' : 'Kanban refill'}</td>
              <td className="px-3 py-1 font-sans text-neutral-300">{x.pn ? getPart(x.pn).description : '—'}</td>
              <td className="px-3 py-1 text-neutral-400">{place(x.from)}</td>
              <td className="px-3 py-1 text-neutral-400">{place(x.to)}</td>
              <td className="px-3 py-1">{x.pickAt <= t ? formatClock(x.pickAt) : '—'}</td>
              <td className="px-3 py-1">{x.deliveredAt <= t ? formatClock(x.deliveredAt) : '—'}</td>
              <td className="px-3 py-1 text-right">{Math.round(x.departAt - x.dispatchedAt)} s</td>
              <td className={`px-3 py-1 font-sans ${color}`}>{status}</td>
            </tr>
          )
        })}
        {rows.length === 0 && <tr><td colSpan={11} className="px-3 py-3 font-sans text-neutral-500">No trips yet. Press Start in the Simulation panel.</td></tr>}
      </tbody>
    </table>
  )
}
