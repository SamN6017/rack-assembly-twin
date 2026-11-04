import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getPart } from '../data/parts'
import { EXPERIMENTS } from '../sim/experiments'
import type { Kpis } from '../sim/kpis'
import { cachedKpis, formatClock, MAX_COMPARE, useSim, type Scenario } from '../store/simStore'
import { axisProps, ChartCard, ChartTooltip, hourTicks, INK, Legend, SERIES } from './charts'
import { useKpiQueue } from './useKpiQueue'

type Better = 'up' | 'down' | null

interface Metric {
  label: string
  get: (k: Kpis) => number | null
  fmt: (v: number) => string
  better: Better
  /** Smallest difference worth flagging. */
  eps?: number
  hint?: string
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const n1 = (v: number) => v.toFixed(1)
const int = (v: number) => Math.round(v).toLocaleString()

const METRICS: { group: string; rows: Metric[] }[] = [
  { group: 'Production', rows: [
    { label: 'Racks completed', get: (k) => k.racksCompleted, fmt: int, better: 'up' },
    { label: 'Target racks', get: (k) => k.targetRacks, fmt: int, better: null },
    { label: 'Target attainment', get: (k) => k.attainment, fmt: pct, better: 'up', eps: 0.005 },
    { label: 'Feasible rate (racks/h)', get: (k) => k.feasibleRate, fmt: n1, better: 'up', eps: 0.05, hint: 'Material-feasible: no station cycle times' },
    { label: 'Time lost to shortages (h)', get: (k) => k.blockedH, fmt: n1, better: 'down', eps: 0.05 },
    { label: 'Line stops', get: (k) => k.blockEvents, fmt: int, better: 'down' },
    { label: 'Short racks (pass mode)', get: (k) => k.starvationEvents, fmt: int, better: 'down' },
  ] },
  { group: 'Kanban replenishment', rows: [
    { label: 'Kanbans refilled', get: (k) => k.cardsReplenished, fmt: int, better: null },
    { label: 'Late refills', get: (k) => k.lateCards, fmt: int, better: 'down', hint: 'Refilled after the lead time, including ones still open at the end' },
    { label: 'Avg refill lead (min)', get: (k) => k.avgReplenishMin, fmt: int, better: 'down', eps: 1 },
    { label: 'Max refill lead (min)', get: (k) => k.maxReplenishMin, fmt: int, better: 'down', eps: 1 },
    { label: 'Cards on loop · peak', get: (k) => k.loopPeak, fmt: int, better: 'down' },
    { label: 'Cards on loop · mean', get: (k) => k.loopMean, fmt: n1, better: 'down', eps: 0.05 },
  ] },
  { group: 'Material handling', rows: [
    { label: 'POU deliveries', get: (k) => k.deliveries, fmt: int, better: null },
    { label: 'Kanban refill trips', get: (k) => k.refillTrips, fmt: int, better: null },
    { label: 'CLS queue (min)', get: (k) => k.clsQueueMin, fmt: n1, better: 'down', eps: 0.05 },
    { label: 'Call to delivery (min)', get: (k) => k.clsDeliveryMin, fmt: n1, better: 'down', eps: 0.05 },
    { label: 'Worst delivery (min)', get: (k) => k.clsDeliveryMaxMin, fmt: n1, better: 'down', eps: 0.05 },
    { label: 'CLS utilisation', get: (k) => k.utilCls, fmt: pct, better: null },
    { label: 'DSV utilisation', get: (k) => k.utilDsv, fmt: pct, better: null },
  ] },
  { group: 'Inventory', rows: [
    { label: 'Floor stock at start (pcs)', get: (k) => k.startPieces, fmt: int, better: null },
    { label: 'Third-Kanban reserve (pcs)', get: (k) => k.reservePieces, fmt: int, better: null, hint: 'Extra inventory held at DSV (Experiment B)' },
    { label: 'Lowest part cover (h)', get: (k) => k.coverage[0]?.minH ?? null, fmt: n1, better: 'up', eps: 0.05 },
  ] },
]

/** What differs from the reference scenario, in words. */
function diffSummary(ref: Scenario, s: Scenario): string {
  if (ref.id === s.id) return 'reference'
  const a = ref.config, b = s.config
  const out: string[] = []
  if (a.ratePerHour !== b.ratePerHour) out.push(`${b.ratePerHour}/h`)
  if (a.shiftH * a.shifts !== b.shiftH * b.shifts) out.push(`${b.shifts}×${b.shiftH} h`)
  if (a.inspectionIntervalMin !== b.inspectionIntervalMin) out.push(`inspect ${b.inspectionIntervalMin} min`)
  if (a.clsHandlers !== b.clsHandlers || a.dsvHandlers !== b.dsvHandlers) out.push(`${b.clsHandlers}+${b.dsvHandlers} handlers`)
  if (a.dsvPrepMin !== b.dsvPrepMin || a.dsvPrepTeams !== b.dsvPrepTeams) out.push(`prep ${b.dsvPrepMin} min ×${b.dsvPrepTeams}`)
  if (a.shortage !== b.shortage) out.push(b.shortage === 'pass' ? 'pass short' : 'stop line')
  if (JSON.stringify(a.extraKanbanPns) !== JSON.stringify(b.extraKanbanPns)) out.push(`3rd Kanban ×${b.extraKanbanPns.length}`)
  if (JSON.stringify(a.stock) !== JSON.stringify(b.stock)) out.push(`stock changed ×${Object.keys(b.stock).length}`)
  if (a.bloomShare !== b.bloomShare) out.push(`Bloom ${Math.round(b.bloomShare * 100)}%`)
  if (a.pouReorderRacks !== b.pouReorderRacks) out.push(`reorder ${b.pouReorderRacks}`)
  if (a.clsPriority !== b.clsPriority) out.push(b.clsPriority)
  if (a.seed !== b.seed) out.push(`seed ${b.seed}`)
  if (a.vEmpty !== b.vEmpty || a.vLoaded !== b.vLoaded || a.loadS !== b.loadS) out.push('handling times')
  if (a.leadTimeH !== b.leadTimeH) out.push(`due ${b.leadTimeH} h`)
  return out.join(' · ') || 'same settings'
}

function Delta({ v, base, m }: { v: number; base: number; m: Metric }) {
  const d = v - base
  if (Math.abs(d) <= (m.eps ?? 0)) return <span className="text-neutral-600">=</span>
  const good = m.better === null ? null : (d > 0) === (m.better === 'up')
  const tone = good === null ? 'text-neutral-400' : good ? 'text-emerald-300' : 'text-red-300'
  return <span className={tone}>{d > 0 ? '▲' : '▼'} {m.fmt(Math.abs(d))}</span>
}

/** Scenario picker: every scenario, grouped, with a checkbox (up to four). */
function Picker() {
  const { scenarios, compare, toggleCompare } = useSim()
  const slotOf = new Map(compare.map((c) => [c.id, c.slot]))
  const groups = [
    { title: 'Saved', items: scenarios.filter((s) => !s.experiment) },
    ...EXPERIMENTS.map((e) => ({ title: `Experiment ${e.id} · ${e.title}`, items: scenarios.filter((s) => s.experiment === e.id) })),
  ].filter((g) => g.items.length)
  return (
    <div className="flex min-h-0 flex-col border-r border-white/5">
      <div className="border-b border-white/5 px-3 py-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">Compare</div>
        <div className="text-[10px] text-neutral-500">Pick up to {MAX_COMPARE}. The first picked is the reference.</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {groups.map((g) => (
          <div key={g.title} className="mb-1.5">
            <div className="px-1.5 text-[10px] uppercase tracking-wider text-neutral-500">{g.title}</div>
            {g.items.map((s) => {
              const slot = slotOf.get(s.id)
              const full = slot === undefined && compare.length >= MAX_COMPARE
              return (
                <label key={s.id} className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] ${full ? 'text-neutral-600' : 'cursor-pointer text-neutral-300 hover:bg-white/[0.03]'}`}>
                  <input type="checkbox" className="accent-sky-500" checked={slot !== undefined} disabled={full} onChange={() => toggleCompare(s.id)} />
                  {slot !== undefined && <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SERIES[slot] }} />}
                  <span className="truncate" title={s.name}>{s.name}</span>
                  {compare[0]?.id === s.id && <span className="ml-auto text-[9px] uppercase text-neutral-500">ref</span>}
                </label>
              )
            })}
          </div>
        ))}
        <p className="px-1.5 text-[10px] leading-snug text-neutral-500">Create scenarios with experiments A–E in the Production Simulator tab, or Save as in the Scenario panel.</p>
      </div>
    </div>
  )
}

/**
 * Scenario Comparison tab: up to four scenarios side by side, KPI deltas against the reference,
 * and the shifts overlaid. Every scenario runs through the same engine with its own seed setting.
 */
export function CompareView() {
  const { scenarios, compare, loadScenario } = useSim()
  const picked = compare.map((c) => ({ ...c, s: scenarios.find((x) => x.id === c.id)! })).filter((c) => c.s)
  const left = useKpiQueue(picked.map((p) => p.s.config))
  const rows = picked.map((p) => ({ ...p, k: cachedKpis(p.s.config) }))
  const ready = rows.filter((r): r is typeof r & { k: Kpis } => !!r.k)
  const ref = rows[0]
  const H = Math.max(1, ...ready.map((r) => r.k.horizonH))

  // One row per sample time with a column per scenario, for overlaid lines.
  const overlay = useMemo(() => {
    const byT = new Map<number, Record<string, number>>()
    for (const r of ready) for (const p of r.k.series) {
      const row = byT.get(p.h) ?? { h: p.h }
      row[`racks_${r.id}`] = p.racks
      row[`lost_${r.id}`] = p.lostMin / 60
      row[`loop_${r.id}`] = p.loop
      byT.set(p.h, row)
    }
    return [...byT.values()].sort((a, b) => a.h - b.h)
  }, [ready.map((r) => r.id).join()])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!picked.length) {
    return <div className="grid h-full grid-cols-[230px_minmax(0,1fr)]"><Picker /><p className="p-4 text-[12px] text-neutral-500">Pick scenarios on the left to compare them.</p></div>
  }

  const legend = <Legend items={ready.map((r) => ({ label: r.s.name, color: SERIES[r.slot] }))} />
  const ticks = hourTicks(H)
  const xAxis = <XAxis dataKey="h" type="number" domain={[0, H]} ticks={ticks} tickFormatter={(v: number) => `${v}h`} {...axisProps} />
  const margin = { top: 4, right: 8, bottom: 0, left: -18 }
  const lines = (key: string) => ready.map((r) => (
    <Line key={r.id} type="stepAfter" dataKey={`${key}_${r.id}`} name={r.s.name} stroke={SERIES[r.slot]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
  ))
  const bars = ready.map((r) => ({ name: r.s.name, slot: r.slot, lost: r.k.blockedH, late: r.k.lateCards, attain: r.k.attainment * 100 }))

  return (
    <div className="grid h-full grid-cols-[230px_minmax(0,1fr)]">
      <Picker />
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">Scenario comparison</span>
          <span className="text-[10px] text-neutral-500">{left ? `computing ${left} run${left > 1 ? 's' : ''}…` : 'simulated · rests on placeholder handler, prep and model-mix values'}</span>
        </div>
        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2">
          <div className="min-h-0 min-w-[420px] flex-1 overflow-auto rounded-md ring-1 ring-white/5">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 z-10 bg-[#141518]">
                <tr>
                  <th className="px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-neutral-500">Metric</th>
                  {rows.map((r) => (
                    <th key={r.id} className="px-2 py-1 text-right font-normal">
                      <button onClick={() => loadScenario(r.id)} title="Show this scenario in 3D" className="inline-flex max-w-[150px] items-center gap-1.5 text-neutral-200 hover:underline">
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SERIES[r.slot] }} />
                        <span className="truncate">{r.s.name}</span>
                      </button>
                      <div className="ml-auto max-w-[150px] truncate text-[10px] text-neutral-500" title={diffSummary(ref.s, r.s)}>{diffSummary(ref.s, r.s)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              {METRICS.map((g) => (
                <tbody key={g.group} className="font-mono">
                  <tr><td colSpan={rows.length + 1} className="bg-white/[0.02] px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wider text-neutral-400">{g.group}</td></tr>
                  {g.rows.map((m) => {
                    const refV = ref.k ? m.get(ref.k) : null
                    return (
                      <tr key={m.label} className="border-t border-white/[0.04]">
                        <td className="whitespace-nowrap px-2 py-0.5 font-sans text-neutral-400" title={m.hint}>{m.label}</td>
                        {rows.map((r, i) => {
                          const v = r.k ? m.get(r.k) : null
                          return (
                            <td key={r.id} className="whitespace-nowrap px-2 py-0.5 text-right">
                              {r.k ? (v === null ? <span className="text-neutral-600">—</span> : <>
                                <span className="text-neutral-100">{m.fmt(v)}</span>
                                {i > 0 && refV !== null && <span className="ml-1.5 text-[10px]"><Delta v={v} base={refV} m={m} /></span>}
                              </>) : <span className="text-neutral-600">…</span>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              ))}
              <tbody>
                <tr><td colSpan={rows.length + 1} className="bg-white/[0.02] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Main constraints (line waited, min · first stop)</td></tr>
                <tr className="align-top">
                  <td className="px-2 py-1 text-[10px] text-neutral-500">Top 3 parts</td>
                  {rows.map((r) => (
                    <td key={r.id} className="px-2 py-1 text-right text-[10px] text-neutral-300">
                      {r.k?.constrained.length ? r.k.constrained.slice(0, 3).map((c) => (
                        <div key={c.pn} className="truncate" title={c.pn}>{getPart(c.pn).description} · {c.blockedSec < 60 ? '<1' : Math.round(c.blockedSec / 60)} · {formatClock(c.firstAt).slice(0, 5)}</div>
                      )) : <span className="text-neutral-600">none</span>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="px-2 py-1.5 text-[10px] text-neutral-500">▲▼ change against the reference; green is better, red worse, grey neutral. Hover a metric for its definition.</p>
          </div>

          <div className="grid min-h-0 w-[500px] shrink-0 grid-cols-2 grid-rows-2 gap-2">
            <ChartCard title="Racks completed over the shift" legend={legend} width="auto">
              <ResponsiveContainer>
                <LineChart data={overlay} margin={margin}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  {xAxis}
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip unit="racks" />} cursor={{ stroke: INK.axis }} />
                  {lines('racks')}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Time lost to shortages (h, cumulative)" legend={legend} width="auto">
              <ResponsiveContainer>
                <LineChart data={overlay} margin={margin}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  {xAxis}
                  <YAxis {...axisProps} />
                  <Tooltip content={<ChartTooltip unit="h" />} cursor={{ stroke: INK.axis }} />
                  {lines('lost')}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Kanbans on the replenishment loop" legend={legend} width="auto">
              <ResponsiveContainer>
                <LineChart data={overlay} margin={margin}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  {xAxis}
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: INK.axis }} />
                  {lines('loop')}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Target attainment (%)" width="auto">
              <ResponsiveContainer>
                <BarChart data={bars} margin={{ top: 14, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={INK.grid} vertical={false} />
                  <XAxis dataKey="name" {...axisProps} tick={false} />
                  <YAxis {...axisProps} domain={[0, 100]} />
                  <Tooltip content={<ChartTooltip unit="%" labelFormat={String} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                  <Bar dataKey="attain" name="Attainment" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}
                    label={{ position: 'top', fill: INK.secondary, fontSize: 10, formatter: (v: unknown) => (typeof v === 'number' ? `${Math.round(v)}%` : '') }}>
                    {bars.map((b) => <Cell key={b.name} fill={SERIES[b.slot]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      </div>
    </div>
  )
}
