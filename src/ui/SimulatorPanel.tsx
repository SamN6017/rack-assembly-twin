import { useMemo, useState } from 'react'
import { getPart, KANBAN_PARTS, modelTab } from '../data/parts'
import { LAYOUT } from '../layout/factoryLayout'
import { EXPERIMENTS, focusLabel, type ExperimentId } from '../sim/experiments'
import type { Kpis } from '../sim/kpis'
import { isTracked, targetBy } from '../sim/movementSim'
import { cachedKpis, formatClock, kpisFor, sameConfig, simClock, useSim, type Scenario } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { ConfidenceBadge } from './common'
import { dur } from './kanbanUi'
import { useKpiQueue } from './useKpiQueue'
import { useSimTime } from './useSimTime'

const TRACKED = KANBAN_PARTS.filter(isTracked)
const TAB_COLOR = { shared: 'bg-[#f2c218]', bloom: 'bg-[#2e9e4a]', yawn: 'bg-transparent ring-1 ring-neutral-500' }
const stationOf = (pn: string) => LAYOUT.stations.find((s) => s.pou.some((p) => p.pn === pn))?.id ?? null
const keyLabel = (key: string) => {
  const [st, pn] = key.split(':')
  return `${getPart(pn).description} @ ${st}`
}
const pct = (v: number) => `${Math.round(v * 100)}%`
const h1 = (v: number) => (v === 0 ? '0' : v < 0.05 ? '<0.1' : v.toFixed(1))

function Head({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">{title}</span>
      {right}
    </div>
  )
}

function Stat({ label, value, tone, badge }: { label: string; value: React.ReactNode; tone?: 'bad' | 'warn' | 'ok'; badge?: 'verified' | 'estimated' | 'placeholder' }) {
  const c = tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-300' : 'text-neutral-100'
  return (
    <div className="flex items-center justify-between py-0.5 text-[12px]">
      <span className="text-neutral-400">{label}</span>
      <span className={`flex items-center gap-1.5 font-mono ${c}`}>{value}{badge && <ConfidenceBadge value={badge} />}</span>
    </div>
  )
}

/** Live line state, output against target, and the log of stops for missing material. */
function LineColumn() {
  const t = useSimTime(250)
  const { result, snapshot, config, seek } = useSim()
  const select = useUi((s) => s.select)
  const line = snapshot.line
  const target = targetBy(result, t)
  const stops = result.blocks.filter((b) => b.from <= t)
  const stoppedSec = stops.reduce((a, b) => a + Math.min(b.to ?? result.horizon, t) - b.from, 0)
  const locate = (key: string) => {
    const [st, pn] = key.split(':')
    select(`pou:${st}:${pn}`, { focus: true })
  }
  return (
    <div className="flex min-h-0 flex-col border-r border-white/5">
      <Head title="Paced line" right={<span className="font-mono text-[11px] text-neutral-500">{formatClock(t)}</span>} />
      <div className="px-3 py-2">
        {line.blocked ? (
          <div className="rounded bg-red-500/10 px-2 py-1.5 ring-1 ring-red-500/40">
            <div className="flex items-center justify-between text-[12px] font-semibold text-red-200">
              <span>LINE STOPPED</span><span className="font-mono">{dur(t - line.since)}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-red-200/80">Waiting for</div>
            {line.keys.map((k) => (
              <button key={k} onClick={() => locate(k)} className="block w-full truncate text-left font-mono text-[11px] text-red-100 hover:underline">{keyLabel(k)}</button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-between rounded bg-emerald-500/10 px-2 py-1.5 text-[12px] font-semibold text-emerald-200 ring-1 ring-emerald-500/30">
            <span>{t >= result.horizon ? 'SHIFT ENDED' : 'LINE RUNNING'}</span>
            <span className="font-mono text-[11px] font-normal">takt {dur(result.takt)}</span>
          </div>
        )}
        <div className="mt-2">
          <Stat label="Target rate" value={`${config.ratePerHour} racks/h`} badge="verified" />
          <Stat label="Racks completed" value={`${snapshot.racksCompleted} / ${target}`} />
          <Stat label="Attainment so far" value={pct(snapshot.racksCompleted / Math.max(1, target))} tone={snapshot.racksCompleted < target ? 'warn' : 'ok'} />
          <Stat label="Time lost to shortages" value={dur(stoppedSec)} tone={stoppedSec ? 'bad' : undefined} />
          <Stat label="Stops" value={stops.length} />
          {config.shortage === 'pass' && <Stat label="Short racks (pass mode)" value={result.starvations.filter((s) => s.from <= t).length} tone="warn" />}
        </div>
        <p className="mt-1 text-[10px] leading-snug text-neutral-500">Material-feasible output: station cycle times are unknown, so the takt stands in for them.</p>
      </div>
      <div className="border-t border-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Stops for missing material</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {stops.length === 0 && <p className="px-1.5 text-[11px] text-neutral-500">{config.shortage === 'pass' ? 'Pass mode: the line never stops; short racks are logged instead.' : 'No stops yet.'}</p>}
        {[...stops].reverse().map((b) => (
          <button
            key={b.from}
            onClick={() => { seek(b.from + 1); locate(b.keys[0]) }}
            className="block w-full rounded px-1.5 py-1 text-left hover:bg-white/[0.04]"
            title="Jump to this stop and locate the part"
          >
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-neutral-300">{formatClock(b.from)}</span>
              <span className="text-red-300">{b.to === undefined || b.to > t ? `${dur(t - b.from)}…` : dur(b.to - b.from)}</span>
            </div>
            <div className="truncate text-[10px] text-neutral-500">{b.keys.map(keyLabel).join(', ')}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

const COLS = ['Scenario', 'Racks', 'Attain.', 'Lost h', 'Stops', 'Late refills', 'Refill min', 'CLS queue', 'Delivery', 'Util CLS / DSV', 'Extra stock', 'Main constraint', '']

function ScenarioRow({ s, k, active, onLoad }: { s: Scenario; k: Kpis | undefined; active: boolean; onLoad: () => void }) {
  const { duplicate, remove } = useSim()
  const cell = 'px-2 py-1 text-right'
  const top = k?.constrained[0]
  return (
    <tr className={`border-t border-white/[0.04] ${active ? 'bg-sky-500/10' : 'hover:bg-white/[0.02]'}`}>
      <td className="max-w-[180px] truncate px-2 py-1 font-sans text-neutral-200" title={s.name}>
        <button onClick={onLoad} className="text-left hover:underline">{s.name}</button>
      </td>
      {k ? <>
        <td className={cell}>{k.racksCompleted}/{k.targetRacks}</td>
        <td className={`${cell} ${k.attainment < 0.98 ? 'text-amber-300' : 'text-emerald-300'}`}>{pct(k.attainment)}</td>
        <td className={`${cell} ${k.blockedH > 0 ? 'text-red-300' : ''}`}>{h1(k.blockedH)}</td>
        <td className={cell}>{k.blockEvents || (k.starvationEvents ? `${k.starvationEvents} short` : 0)}</td>
        <td className={`${cell} ${k.lateCards ? 'text-amber-300' : ''}`}>{k.lateCards}/{k.cardsReplenished}</td>
        <td className={cell}>{k.avgReplenishMin === null ? '—' : Math.round(k.avgReplenishMin)}</td>
        <td className={cell}>{k.clsQueueMin.toFixed(1)}m</td>
        <td className={cell}>{k.clsDeliveryMin.toFixed(1)}m</td>
        <td className={cell}>{pct(k.utilCls)} / {pct(k.utilDsv)}</td>
        <td className={cell}>{k.reservePieces ? `+${k.reservePieces.toLocaleString()}` : '—'}</td>
        <td className="max-w-[160px] truncate px-2 py-1 font-sans text-[11px] text-neutral-400" title={k.constrained.map((c) => `${c.pn} ${Math.round(c.blockedSec / 60)} min from ${formatClock(c.firstAt)}`).join('\n')}>
          {top ? `${getPart(top.pn).description} · ${top.blockedSec < 60 ? '<1' : Math.round(top.blockedSec / 60)}m from ${formatClock(top.firstAt).slice(0, 5)}` : '—'}
        </td>
      </> : <td colSpan={11} className="px-2 py-1 text-neutral-500">running…</td>}
      <td className="whitespace-nowrap px-2 py-1 text-right font-sans">
        <button onClick={onLoad} title="Show this scenario in 3D" className="px-1 text-sky-300 hover:text-sky-100">▶</button>
        <button onClick={() => duplicate(s.id)} title="Duplicate" className="px-1 text-neutral-400 hover:text-neutral-100">⧉</button>
        {!s.builtIn && <button onClick={() => remove(s.id)} title="Delete" className="px-1 text-neutral-500 hover:text-red-300">✕</button>}
      </td>
    </tr>
  )
}

/** Experiments A–E and every saved scenario with its headline results. */
function ScenarioColumn() {
  const { scenarios, activeId, config, focus, loadScenario, addExperiment } = useSim()
  const left = useKpiQueue(scenarios.map((s) => s.config))
  const groups: { id: ExperimentId | 'saved'; title: string; question?: string; items: Scenario[] }[] = [
    { id: 'saved' as const, title: 'Saved scenarios', items: scenarios.filter((s) => !s.experiment) },
    ...EXPERIMENTS.map((e) => ({ id: e.id, title: `Experiment ${e.id} · ${e.title}`, question: e.question, items: scenarios.filter((s) => s.experiment === e.id) })),
  ].filter((g) => g.items.length)
  return (
    <div className="flex min-h-0 flex-col border-r border-white/5">
      <Head title="What-if experiments" right={<span className="text-[10px] text-neutral-500">{left ? `computing ${left} run${left > 1 ? 's' : ''}…` : 'same engine, same seed for every scenario'}</span>} />
      <div className="flex flex-wrap gap-1.5 border-b border-white/5 px-3 py-2">
        {EXPERIMENTS.map((e) => (
          <button
            key={e.id}
            onClick={() => addExperiment(e.id)}
            title={`${e.question}\nBuilt from the applied scenario${e.usesFocus ? `; focus parts: ${focusLabel(focus)}` : ''}`}
            className="rounded bg-white/[0.03] px-2 py-1 text-left text-[11px] text-neutral-300 ring-1 ring-white/10 hover:bg-white/[0.07]"
          >
            <span className="font-semibold text-sky-300">{e.id}</span> {e.title}
          </button>
        ))}
        <span className="self-center text-[10px] text-neutral-500">Variants start from the applied settings ({config.ratePerHour}/h, {config.clsHandlers}+{config.dsvHandlers} handlers).</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#111214] text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>{COLS.map((c, i) => <th key={i} className={`whitespace-nowrap px-2 py-1 font-medium ${i > 0 && i < 11 ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.id} className="font-mono">
              <tr><td colSpan={COLS.length} className="bg-white/[0.02] px-2 py-1 font-sans text-[10px] text-neutral-400"><span className="font-semibold uppercase tracking-wider text-neutral-300">{g.title}</span>{g.question && <span className="ml-2">{g.question}</span>}</td></tr>
              {g.items.map((s) => <ScenarioRow key={s.id} s={s} k={cachedKpis(s.config)} active={s.id === activeId && sameConfig(s.config, config)} onLoad={() => loadScenario(s.id)} />)}
            </tbody>
          ))}
        </table>
        <p className="px-3 py-2 text-[10px] leading-snug text-neutral-500">
          Lost h: line stopped for missing material. Late refills: Kanbans refilled more than the lead time after emptying (including ones still open at the end), out of those refilled. Queue and delivery: mean minutes from POU call to dispatch and to drop-off. Extra stock: pieces held in third Kanbans. Results rest on placeholder handler speeds, DSV prep time and model mix. Compare scenarios side by side in the Scenario Comparison tab.
        </p>
      </div>
    </div>
  )
}

function Pct({ value, onChange, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder: string }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text === null) return
    const v = text.trim() === '' ? undefined : Math.max(0, Math.min(100, Number(text)))
    if (v === undefined || Number.isFinite(v)) onChange(v === undefined ? undefined : v / 100)
    setText(null)
  }
  return (
    <input
      value={text ?? (value === undefined ? '' : Math.round(value * 100))}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        const v = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 100) onChange(v / 100)
      }}
      onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit() }}
      className={`w-11 rounded bg-white/[0.04] px-1 py-px text-right font-mono text-[11px] ring-1 focus:outline-none focus:ring-sky-500/50 ${value === undefined ? 'text-neutral-500 ring-white/5' : 'text-sky-200 ring-sky-500/40'}`}
    />
  )
}

/** Per-part settings: focus parts for experiments B and E, third Kanbans and starting stock. */
function PartsColumn() {
  const { draft, config, setDraft, applyDraft, revertDraft, focus, setFocus, result } = useSim()
  const select = useUi((s) => s.select)
  const k = useMemo(() => kpisFor(config, result), [config, result])
  const cover = new Map(k.coverage.map((c) => [c.pn, c]))
  const stops = new Map(k.constrained.map((c) => [c.pn, c]))
  const dirty = !sameConfig(draft, config)
  const setStock = (pn: string, field: 'kanban' | 'pou', v: number | undefined) => {
    const stock = { ...draft.stock }
    const entry = { ...stock[pn], [field]: v }
    if (entry.kanban === undefined) delete entry.kanban
    if (entry.pou === undefined) delete entry.pou
    if (Object.keys(entry).length) stock[pn] = entry
    else delete stock[pn]
    setDraft({ stock })
  }
  const toggleExtra = (pn: string) => setDraft({ extraKanbanPns: draft.extraKanbanPns.includes(pn) ? draft.extraKanbanPns.filter((x) => x !== pn) : [...draft.extraKanbanPns, pn] })
  const toggleFocus = (pn: string) => setFocus(focus.includes(pn) ? focus.filter((x) => x !== pn) : [...focus, pn])
  const rows = [...TRACKED].sort((a, b) => (cover.get(a.pn)?.minH ?? 99) - (cover.get(b.pn)?.minH ?? 99))
  return (
    <div className="flex min-h-0 flex-col">
      <Head title="Parts · stock & Kanbans" right={dirty ? (
        <span className="flex gap-1">
          <button onClick={applyDraft} className="rounded bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-100 ring-1 ring-sky-500/40 hover:bg-sky-500/25">Apply & rerun</button>
          <button onClick={revertDraft} className="rounded px-2 py-0.5 text-[11px] text-neutral-400 ring-1 ring-white/10 hover:text-neutral-200">Revert</button>
        </span>
      ) : <span className="text-[10px] text-neutral-500">sorted by lowest cover this run</span>} />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#111214] text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-1.5 py-1 font-medium" title="Focus parts for experiments B and E">Focus</th>
              <th className="px-1.5 py-1 text-left font-medium">Part</th>
              <th className="px-1.5 py-1 font-medium" title="Third Kanban, held prepared at DSV">3rd K</th>
              <th className="px-1.5 py-1 text-right font-medium" title="Starting stock on both Kanbans, % of full (blank = full)">Kanban %</th>
              <th className="px-1.5 py-1 text-right font-medium" title="Starting POU pallet, % of full (blank = seeded part-used pallet)">POU %</th>
              <th className="px-1.5 py-1 text-right font-medium" title="Lowest hours of cover reached this run (Kanbans + POU)">Min cover</th>
              <th className="px-1.5 py-1 text-right font-medium" title="Minutes the line waited for this part this run">Stopped</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((p) => {
              const c = cover.get(p.pn)
              const st = stops.get(p.pn)
              const station = stationOf(p.pn)
              return (
                <tr key={p.pn} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-1.5 text-center"><input type="checkbox" className="accent-sky-500" checked={focus.includes(p.pn)} onChange={() => toggleFocus(p.pn)} /></td>
                  <td className="max-w-[170px] px-1.5 py-0.5">
                    <button onClick={() => select(station ? `pou:${station}:${p.pn}` : `kanban:${p.pn}#0:0`, { focus: true })} className="flex w-full items-center gap-1.5 text-left hover:underline" title={`${p.description} · ${p.workstation} · ${p.kanbanPallets} pallets per Kanban`}>
                      <span className={`h-2 w-2 shrink-0 rounded-sm ${TAB_COLOR[modelTab(p)]}`} />
                      <span className="truncate font-sans text-neutral-200">{p.description}</span>
                      <span className="shrink-0 text-[10px] text-neutral-500">{p.workstation}</span>
                    </button>
                  </td>
                  <td className="px-1.5 text-center"><input type="checkbox" className="accent-sky-500" checked={draft.extraKanbanPns.includes(p.pn)} onChange={() => toggleExtra(p.pn)} /></td>
                  <td className="px-1.5 text-right"><Pct value={draft.stock[p.pn]?.kanban} placeholder="100" onChange={(v) => setStock(p.pn, 'kanban', v)} /></td>
                  <td className="px-1.5 text-right"><Pct value={draft.stock[p.pn]?.pou} placeholder="seed" onChange={(v) => setStock(p.pn, 'pou', v)} /></td>
                  <td className={`px-1.5 text-right ${c && c.minH < 0.25 ? 'text-red-300' : c && c.minH < 1 ? 'text-amber-300' : 'text-neutral-300'}`} title={c ? `start ${c.startH.toFixed(1)} h · low at ${formatClock(c.minAt)} · end ${c.endH.toFixed(1)} h` : ''}>{c ? `${c.minH.toFixed(1)}h` : '—'}</td>
                  <td className={`px-1.5 text-right ${st?.blockedSec ? 'text-red-300' : 'text-neutral-500'}`}>{st?.blockedSec ? `${st.blockedSec < 60 ? '<1' : Math.round(st.blockedSec / 60)}m` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-3 py-2 text-[10px] leading-snug text-neutral-500">
          A third Kanban is an extra full set of pallets held prepared at DSV: a collected card goes straight to staging and DSV re-prepares the spare. Reduced Kanban stock empties Kanban #1 first. {simClock.t > 0 ? 'Applying restarts the clock.' : ''}
        </p>
      </div>
    </div>
  )
}

/** Production Simulator tab: line state, experiments and part-level scenario settings. */
export function SimulatorPanel() {
  return (
    <div className="grid h-full grid-cols-[250px_minmax(560px,1fr)_minmax(380px,430px)] overflow-x-auto">
      <LineColumn />
      <ScenarioColumn />
      <PartsColumn />
    </div>
  )
}
