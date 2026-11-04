import { useState } from 'react'
import { KANBAN_PARTS, modelTab } from '../data/parts'
import { resolveEntity } from '../scene/entities'
import { useUi } from '../store/uiStore'
import { ConfidenceBadge } from './common'
import { Dashboard } from './Dashboard'
import { EventLog } from './EventLog'
import { TaskLog } from './TaskLog'

const TAB_COLOR = { shared: 'bg-[#f2c218]', bloom: 'bg-[#2e9e4a]', yawn: 'bg-transparent ring-1 ring-neutral-600' }

/** Bottom panel: live dashboard, event log, handler trips and the Kanban part master from the sheet. */
export function BottomPanel() {
  const [tab, setTab] = useState<'dashboard' | 'events' | 'parts' | 'tasks'>('dashboard')
  const [query, setQuery] = useState('')
  const select = useUi((s) => s.select)
  const selectedPn = useUi((s) => (s.selected ? resolveEntity(s.selected)?.pn : undefined))
  const q = query.trim().toLowerCase()
  const rows = q
    ? KANBAN_PARTS.filter((p) => [p.pn, p.altPn ?? '', p.description, p.workstation ?? '', ...p.models].some((f) => f.toLowerCase().includes(q)))
    : KANBAN_PARTS

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-white/5 px-4 py-2">
        <div className="flex gap-1">
          {([['dashboard', 'Dashboard'], ['events', 'Event log'], ['tasks', 'Handler trips'], ['parts', 'Kanban parts']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wider ${tab === id ? 'bg-white/10 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>{label}</button>
          ))}
        </div>
        {tab === 'parts' && <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && rows[0]) select(`kanban:${rows[0].pn}#0:0`, { focus: true })
          }}
          placeholder="Find part number, description, station…"
          className="w-72 rounded bg-white/[0.04] px-2 py-1 text-[12px] text-neutral-100 ring-1 ring-white/10 placeholder:text-neutral-500 focus:outline-none focus:ring-sky-500/50"
        />}
        {tab === 'parts' && <span className="text-[11px] text-neutral-500">{rows.length} of {KANBAN_PARTS.length}</span>}
        <span className="ml-auto text-[11px] text-neutral-500">{tab === 'dashboard' ? 'Simulated values up to the clock; only the target rate is from the sources' : tab === 'events' ? 'Click an event to locate it in 3D' : tab === 'parts' ? 'Click a row to locate its Kanban' : 'Click a row to select the handler'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'dashboard' ? <Dashboard /> : tab === 'events' ? <EventLog /> : tab === 'tasks' ? <TaskLog /> : <>
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-[#111214] text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              {['Part number', 'Description', 'Model', 'Station', 'Qty / rack', 'Qty / pallet', 'Kanban pallets', 'Hours / Kanban', 'Data'].map((h, i) => (
                <th key={h} className={`px-3 py-1.5 font-medium ${i >= 4 && i <= 7 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((p) => (
              <tr
                key={p.pn}
                onClick={() => select(`kanban:${p.pn}#0:0`, { focus: true })}
                className={`cursor-pointer border-t border-white/[0.04] ${selectedPn === p.pn ? 'bg-sky-500/10' : 'hover:bg-white/[0.03]'}`}
              >
                <td className="px-3 py-1 text-neutral-100">{p.pn}{p.pnConfidence !== 'verified' && <span className="ml-1 text-amber-400/70" title="Digits read from photo">*</span>}</td>
                <td className="px-3 py-1 font-sans text-neutral-300">{p.description}</td>
                <td className="px-3 py-1 font-sans">
                  <span className="flex items-center gap-1.5 text-neutral-400"><span className={`h-2.5 w-2.5 rounded-sm ${TAB_COLOR[modelTab(p)]}`} />{p.models.join(' + ')}</span>
                </td>
                <td className="px-3 py-1 text-sky-300">{p.workstation ?? '—'}</td>
                <td className="px-3 py-1 text-right">{p.qtyPerRack ?? '—'}</td>
                <td className="px-3 py-1 text-right">{p.qtyPerPallet ?? '—'}</td>
                <td className="px-3 py-1 text-right">{p.kanbanPallets}</td>
                <td className="px-3 py-1 text-right">{p.hoursPerKanban.toFixed(2)}</td>
                <td className="px-3 py-1"><ConfidenceBadge value={p.confidence} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 font-sans text-[11px] text-neutral-500">* Part-number digits read from a 1024 px photo. Confirm against the .xlsx export.</p>
        </>}
      </div>
    </div>
  )
}
