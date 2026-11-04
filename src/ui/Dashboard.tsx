import { useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { KANBAN_PARTS } from '../data/parts'
import { coverageHours } from '../sim/kpis'
import { isTracked, targetBy } from '../sim/movementSim'
import { kpisFor, simClock, useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { axisProps, ChartCard, ChartTooltip, CRITICAL, fmtH, hourTicks, INK, Legend, SERIES } from './charts'
import { ConfidenceBadge } from './common'
import { dur } from './kanbanUi'
import { useSimTime } from './useSimTime'

const TRACKED = KANBAN_PARTS.filter(isTracked)

function Tile({ label, value, sub, tone, badge = 'simulated' }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'bad' | 'warn' | 'ok'; badge?: 'simulated' | 'verified' }) {
  const c = tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-300' : 'text-neutral-100'
  return (
    <div className="rounded-md bg-white/[0.02] px-2 py-1.5 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[10px] uppercase tracking-wide text-neutral-500">{label}</span>
        {badge === 'verified' ? <ConfidenceBadge value="verified" /> : <span className="text-[9px] uppercase tracking-wide text-sky-300/70">sim</span>}
      </div>
      <div className={`font-mono text-[17px] leading-tight ${c}`}>{value}</div>
      {sub && <div className="truncate text-[10px] text-neutral-500">{sub}</div>}
    </div>
  )
}

/**
 * Live production dashboard (brief section 8): KPI tiles for the run up to the current clock and
 * time-series charts of the whole shift so far. Every number is simulated; only the target rate is
 * an operational input from the sources.
 */
export function Dashboard() {
  useSimTime(1000)
  const { result, config, snapshot } = useSim()
  // The authoritative clock, not the polled one: a seek updates the snapshot before the poll catches up.
  const t = simClock.t
  const select = useUi((s) => s.select)
  const kpis = useMemo(() => kpisFor(config, result), [config, result])
  const H = result.horizon / 3600
  const now = t / 3600
  const data = useMemo(() => kpis.series.filter((p) => p.t <= t + 1), [kpis, t])
  const last = data[data.length - 1]

  const stops = result.blocks.filter((b) => b.from <= t)
  const lostSec = stops.reduce((a, b) => a + Math.min(b.to ?? result.horizon, t) - b.from, 0)
  const target = targetBy(result, t)
  const closed = result.cycles.filter((c) => c.replenishedAt !== undefined && c.replenishedAt <= t)
  const avgLead = closed.length ? closed.reduce((a, c) => a + c.replenishedAt! - c.emptyAt, 0) / closed.length : null
  const late = result.cycles.filter((c) => c.dueAt <= t && (c.replenishedAt ?? Infinity) > c.dueAt).length
  const util = (role: 'CLS' | 'DSV') => {
    const ids = new Set(result.handlers.filter((h) => h.role === role).map((h) => h.id))
    if (!t || !ids.size) return 0
    return result.tasks.filter((x) => ids.has(x.handler)).reduce((a, x) => a + Math.max(0, Math.min(x.doneAt, t) - x.dispatchedAt), 0) / (ids.size * t)
  }
  let empty = 0
  for (const n of snapshot.kanban.values()) if (n === 0) empty++
  let loop = 0
  for (const c of snapshot.cards.values()) if (c.state !== 'FULL' && c.state !== 'IN_USE' && c.state !== 'REPLENISHED') loop++
  const shortages = config.shortage === 'block' ? stops.length : result.starvations.filter((s) => s.from <= t).length

  const coverage = useMemo(() => TRACKED
    .map((p) => ({ pn: p.pn, name: p.description, h: coverageHours(snapshot, result, p.pn) ?? 0 }))
    .sort((a, b) => a.h - b.h)
    .slice(0, 8)
    .map((c) => ({ ...c, label: `${c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name}` })), [snapshot, result])

  const stopAreas = result.blocks.filter((b) => b.from <= t).map((b) => ({ x1: b.from / 3600, x2: Math.min(b.to ?? result.horizon, t) / 3600 }))
  const ticks = hourTicks(H)
  const xAxis = <XAxis dataKey="h" type="number" domain={[0, H]} ticks={ticks} tickFormatter={(v: number) => `${v}h`} {...axisProps} />
  const nowLine = <ReferenceLine x={now} stroke={INK.secondary} strokeDasharray="2 3" />
  const grid = <CartesianGrid stroke={INK.grid} vertical={false} />
  const margin = { top: 4, right: 8, bottom: 0, left: -18 }

  return (
    <div className="flex h-full min-h-0 gap-2 overflow-x-auto p-2">
      <div className="grid w-[580px] shrink-0 grid-cols-4 content-start gap-1.5">
        <Tile label="Target" value={`${config.ratePerHour}/h`} sub={`takt ${dur(result.takt)}`} badge="verified" />
        <Tile label="Completed" value={`${snapshot.racksCompleted} / ${target}`} sub={`${result.targetRacks} planned this run`} />
        <Tile label="Attainment" value={`${Math.round((snapshot.racksCompleted / Math.max(1, target)) * 100)}%`} tone={snapshot.racksCompleted < target ? 'warn' : 'ok'} sub="material-feasible" />
        <Tile label="Lost time" value={dur(lostSec)} tone={lostSec ? 'bad' : undefined} sub={`${stops.length} line stop${stops.length === 1 ? '' : 's'}`} />
        <Tile label="Shortages" value={shortages} tone={shortages ? 'bad' : undefined} sub={config.shortage === 'block' ? 'line stops' : 'racks passed short'} />
        <Tile label="Empty Kanbans" value={empty} sub={`of ${snapshot.kanban.size}`} tone={empty ? 'warn' : undefined} />
        <Tile label="Pending refills" value={loop} sub="cards on the loop" />
        <Tile label="Avg refill" value={avgLead === null ? '—' : dur(avgLead)} sub={`${late} late (> ${config.leadTimeH} h)`} tone={late ? 'warn' : undefined} />
        <Tile label="Handler use" value={`${Math.round(util('CLS') * 100)}% · ${Math.round(util('DSV') * 100)}%`} sub={`CLS ×${config.clsHandlers} · DSV ×${config.dsvHandlers}`} />
        <Tile label="In transit" value={(last?.transitPcs ?? 0).toLocaleString()} sub="pcs staged or on forks" />
        <Tile label="At POU" value={(last?.pouPcs ?? 0).toLocaleString()} sub="pcs" />
        <Tile label="In Kanbans" value={(last?.kanbanPcs ?? 0).toLocaleString()} sub="pcs" />
      </div>

      <ChartCard title="Racks completed vs target" legend={<Legend items={[{ label: 'Completed', color: SERIES[0] }, { label: 'Target', color: INK.secondary, dashed: true }, { label: 'Line stopped', color: CRITICAL }]} />}>
        <ResponsiveContainer>
          <LineChart data={data} margin={margin}>
            {grid}
            {xAxis}
            <YAxis {...axisProps} allowDecimals={false} domain={[0, result.targetRacks]} />
            {stopAreas.map((a, i) => <ReferenceArea key={i} x1={a.x1} x2={a.x2} fill={CRITICAL} fillOpacity={0.25} stroke="none" ifOverflow="hidden" />)}
            {nowLine}
            <Tooltip content={<ChartTooltip unit="racks" />} cursor={{ stroke: INK.axis }} />
            <Line type="stepAfter" dataKey="target" name="Target" stroke={INK.secondary} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="racks" name="Completed" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Floor stock by location (pcs)" legend={<Legend items={[{ label: 'Kanbans', color: SERIES[0] }, { label: 'Point of use', color: SERIES[1] }, { label: 'In transit', color: SERIES[2] }]} />} note="Tracked pallet parts only. Stacked: the top edge is total floor stock.">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ ...margin, left: -4 }}>
            {grid}
            {xAxis}
            <YAxis {...axisProps} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
            {nowLine}
            <Tooltip content={<ChartTooltip unit="pcs" />} cursor={{ stroke: INK.axis }} />
            <Area type="monotone" dataKey="kanbanPcs" name="Kanbans" stackId="s" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.35} strokeWidth={1.5} isAnimationActive={false} />
            <Area type="monotone" dataKey="pouPcs" name="Point of use" stackId="s" stroke={SERIES[1]} fill={SERIES[1]} fillOpacity={0.35} strokeWidth={1.5} isAnimationActive={false} />
            <Area type="monotone" dataKey="transitPcs" name="In transit" stackId="s" stroke={SERIES[2]} fill={SERIES[2]} fillOpacity={0.35} strokeWidth={1.5} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Replenishment loop (Kanbans)" legend={<Legend items={[{ label: 'Cards on loop', color: SERIES[0] }, { label: 'Empty Kanbans', color: SERIES[1] }]} />}>
        <ResponsiveContainer>
          <LineChart data={data} margin={margin}>
            {grid}
            {xAxis}
            <YAxis {...axisProps} allowDecimals={false} />
            {nowLine}
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: INK.axis }} />
            <Line type="stepAfter" dataKey="loop" name="Cards on loop" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="emptyKanbans" name="Empty Kanbans" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Handlers busy" legend={<Legend items={[{ label: 'CLS', color: SERIES[0] }, { label: 'DSV', color: SERIES[1] }]} />} note="Handlers on a task (including waiting for a clear route), sampled every 5 min">
        <ResponsiveContainer>
          <LineChart data={data} margin={margin}>
            {grid}
            {xAxis}
            <YAxis {...axisProps} allowDecimals={false} domain={[0, Math.max(config.clsHandlers, config.dsvHandlers)]} />
            {nowLine}
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: INK.axis }} />
            <Line type="stepAfter" dataKey="busyCls" name="CLS" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="busyDsv" name="DSV" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Lowest coverage now (h) · ${fmtH(now)}`} width={280} note="Hours of consumption the part's Kanbans plus POU cover at the current rate. Click a bar to locate the part.">
        <ResponsiveContainer>
          <BarChart data={coverage} layout="vertical" margin={{ top: 2, right: 26, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={INK.grid} horizontal={false} />
            <XAxis type="number" {...axisProps} />
            <YAxis type="category" dataKey="label" width={96} {...axisProps} tick={{ fill: INK.secondary, fontSize: 10 }} />
            <ReferenceLine x={config.leadTimeH} stroke={INK.secondary} strokeDasharray="2 3" label={{ value: 'lead time', fill: INK.muted, fontSize: 9, position: 'insideTopRight' }} />
            <Tooltip content={<ChartTooltip unit="h" labelFormat={String} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar
              dataKey="h" name="Coverage" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={10} isAnimationActive={false}
              label={{ position: 'right', fill: INK.secondary, fontSize: 10, formatter: (v: unknown) => (typeof v === 'number' ? v.toFixed(1) : '') }}
              onClick={(d: { payload?: { pn: string } }) => { const pn = d.payload?.pn; if (pn) select(`kanban:${pn}#0:0`, { focus: true }) }}
              cursor="pointer"
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="w-1 shrink-0" />
    </div>
  )
}
