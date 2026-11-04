import { useState, type ReactNode } from 'react'
import type { Confidence } from '../data/parts'
import { MAX_HANDLERS, type MovementConfig } from '../sim/movementSim'
import { sameConfig, useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { ConfidenceBadge, Section } from './common'

const input = 'w-[72px] rounded bg-white/[0.04] px-1.5 py-0.5 text-right font-mono text-[12px] text-neutral-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500/50'
const btn = 'rounded px-2 py-1 text-[11px] ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40'

function Field({ label, confidence, changed, children, title }: { label: string; confidence?: Confidence; changed?: boolean; children: ReactNode; title?: string }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5 text-[12px]" title={title}>
      <span className={`flex items-center gap-1 ${changed ? 'text-sky-300' : 'text-neutral-400'}`}>
        {changed && <span className="h-1 w-1 rounded-full bg-sky-400" />}
        {label}
      </span>
      <span className="flex items-center gap-1.5">
        {children}
        {confidence && <ConfidenceBadge value={confidence} />}
      </span>
    </label>
  )
}

type NumKey = { [K in keyof MovementConfig]: MovementConfig[K] extends number ? K : never }[keyof MovementConfig]

/**
 * Number input that keeps whatever the user is typing. A valid in-range value reaches the draft as
 * it is typed (so Apply always sees what the field shows); blur / Enter clamps anything else.
 */
function Num({ k, also, min, max, step = 1, scale = 1, unit }: { k: NumKey; also?: NumKey; min: number; max: number; step?: number; scale?: number; unit?: string }) {
  const value = useSim((s) => s.draft[k]) as number
  const setDraft = useSim((s) => s.setDraft)
  const [text, setText] = useState<string | null>(null)
  const put = (v: number) => setDraft({ [k]: v / scale, ...(also ? { [also]: v / scale } : {}) } as Partial<MovementConfig>)
  const commit = () => {
    if (text === null) return
    const v = Number(text)
    if (text.trim() !== '' && Number.isFinite(v)) put(Math.max(min, Math.min(max, v)))
    setText(null)
  }
  return (
    <span className="flex items-center gap-1">
      <input
        type="number" min={min} max={max} step={step}
        value={text ?? +(value * scale).toFixed(3)}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) put(v)
        }}
        onBlur={commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit() }}
        className={input}
      />
      {unit && <span className="w-7 text-[10px] text-neutral-500">{unit}</span>}
    </span>
  )
}

function Choice<K extends 'shortage' | 'clsPriority'>({ k, options }: { k: K; options: [MovementConfig[K], string][] }) {
  const value = useSim((s) => s.draft[k])
  const setDraft = useSim((s) => s.setDraft)
  return (
    <select
      value={value as string}
      onChange={(e) => setDraft({ [k]: e.target.value } as Partial<MovementConfig>)}
      className="rounded bg-[#1a1b1e] px-1 py-0.5 text-[12px] text-neutral-100 ring-1 ring-white/10 focus:outline-none"
    >
      {options.map(([v, label]) => <option key={v as string} value={v as string}>{label}</option>)}
    </select>
  )
}

function Group({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-t border-white/5 py-1.5 first:border-0">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-neutral-400 hover:text-neutral-200">
        {title}
        <span className="text-neutral-600 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  )
}

/** Scenario picker and the full scenario configuration (brief section 5). */
export function ScenarioForm() {
  const { draft, config, scenarios, activeId, error, applyDraft, revertDraft, loadScenario, saveScenario, saveAs, duplicate } = useSim()
  const setTab = useUi((s) => s.setTab)
  const dirty = !sameConfig(draft, config)
  const active = scenarios.find((s) => s.id === activeId)
  const unsaved = active ? !sameConfig(active.config, config) : true
  const ch = (k: keyof MovementConfig) => JSON.stringify(draft[k]) !== JSON.stringify(config[k])
  const overrides = Object.keys(draft.stock).length

  return (
    <Section title="Scenario" right={<span className="text-[10px] text-neutral-500">{unsaved ? 'modified, not saved' : 'saved'}</span>}>
      <div className="flex gap-1.5">
        <select
          value={activeId}
          onChange={(e) => loadScenario(e.target.value)}
          className="min-w-0 flex-1 rounded bg-[#1a1b1e] px-1.5 py-1 text-[12px] text-neutral-100 ring-1 ring-white/10 focus:outline-none"
        >
          {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <button onClick={saveScenario} disabled={!unsaved || dirty} title={active?.builtIn ? 'Baseline is read-only: saves as a new scenario' : 'Save the applied settings to this scenario'} className={`${btn} bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]`}>Save</button>
        <button
          disabled={dirty}
          onClick={() => { const n = prompt('Scenario name', `${active?.name ?? 'Scenario'} (variant)`); if (n?.trim()) saveAs(n.trim()) }}
          className={`${btn} bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]`}
        >Save as…</button>
        <button onClick={() => duplicate(activeId)} className={`${btn} bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]`}>Duplicate</button>
        <button onClick={() => setTab('simulator')} className={`${btn} ml-auto bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]`} title="Experiments A–E and scenario results">Experiments</button>
      </div>

      <div className="mt-2">
        <Group title="Production demand" open>
          <Field label="Target rate" confidence="verified" changed={ch('ratePerHour')} title="Baseline 5 racks/h (slide P1); the sheet plans 96/day over 18 h"><Num k="ratePerHour" min={1} max={12} step={0.5} unit="/h" /></Field>
          <Field label="Shift length" changed={ch('shiftH')}><Num k="shiftH" min={1} max={12} step={0.5} unit="h" /></Field>
          <Field label="Shifts" changed={ch('shifts')} title="Simulated back to back; breaks and changeovers are not modelled"><Num k="shifts" min={1} max={3} /></Field>
          <Field label="Bloom share" confidence="placeholder" changed={ch('bloomShare')}><Num k="bloomShare" min={0} max={100} step={5} scale={100} unit="%" /></Field>
          <Field label="On shortage" changed={ch('shortage')} title="Stop the paced line until the part arrives, or let the rack pass short (pieces owed)"><Choice k="shortage" options={[['block', 'Stop line'], ['pass', 'Pass short']]} /></Field>
        </Group>
        <Group title="Kanban">
          <Field label="Board inspection" confidence="verified" changed={ch('inspectionIntervalMin')} title="Slide P1: every 1–2 h"><Num k="inspectionIntervalMin" min={15} max={240} step={15} unit="min" /></Field>
          <Field label="DSV prep time" confidence="placeholder" changed={ch('dsvPrepMin')}><Num k="dsvPrepMin" min={5} max={180} step={5} unit="min" /></Field>
          <Field label="Prep teams" confidence="placeholder" changed={ch('dsvPrepTeams')}><Num k="dsvPrepTeams" min={1} max={6} /></Field>
          <Field label="Lead time (due)" confidence="verified" changed={ch('leadTimeH')}><Num k="leadTimeH" min={0.5} max={8} step={0.5} unit="h" /></Field>
          <Field label="Kanbans per part" confidence="verified" changed={ch('extraKanbanPns')}>
            <button onClick={() => setTab('simulator')} className="font-mono text-[12px] text-sky-300 hover:underline">2{draft.extraKanbanPns.length ? ` (+1 on ${draft.extraKanbanPns.length})` : ''}</button>
          </Field>
        </Group>
        <Group title="Material inventory">
          <Field label="POU reorder point" confidence="estimated" changed={ch('pouReorderRacks')} title="Call a pallet when the POU covers fewer racks than this"><Num k="pouReorderRacks" min={1} max={3} unit="racks" /></Field>
          <Field label="Starting stock" changed={ch('stock')}>
            <button onClick={() => setTab('simulator')} className="font-mono text-[12px] text-sky-300 hover:underline">{overrides ? `${overrides} part${overrides > 1 ? 's' : ''} changed` : 'all full'}</button>
          </Field>
        </Group>
        <Group title="Material handling">
          <Field label="CLS handlers" confidence="estimated" changed={ch('clsHandlers')} title={`Up to ${MAX_HANDLERS.CLS} (parking bays)`}><Num k="clsHandlers" min={1} max={MAX_HANDLERS.CLS} /></Field>
          <Field label="DSV handlers" confidence="estimated" changed={ch('dsvHandlers')} title={`Up to ${MAX_HANDLERS.DSV} (parking bays)`}><Num k="dsvHandlers" min={1} max={MAX_HANDLERS.DSV} /></Field>
          <Field label="Carry capacity" confidence="estimated"><span className="font-mono text-[12px] text-neutral-300">1 pallet</span></Field>
          <Field label="Speed empty" confidence="estimated" changed={ch('vEmpty')}><Num k="vEmpty" min={0.3} max={2.5} step={0.1} unit="m/s" /></Field>
          <Field label="Speed loaded" confidence="estimated" changed={ch('vLoaded')}><Num k="vLoaded" min={0.3} max={2.5} step={0.1} unit="m/s" /></Field>
          <Field label="Load / unload" confidence="estimated" changed={ch('loadS') || ch('unloadS')}><Num k="loadS" also="unloadS" min={5} max={120} step={5} unit="s" /></Field>
          <Field label="CLS priority" changed={ch('clsPriority')}><Choice k="clsPriority" options={[['fifo', 'First come'], ['line-stop-first', 'Line-stop first']]} /></Field>
        </Group>
        <Group title="Run">
          <Field label="Random seed" changed={ch('seed')} title="Same seed and settings always give the same run"><Num k="seed" min={1} max={9999} /></Field>
        </Group>
      </div>

      {error && <p className="mt-2 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-300 ring-1 ring-red-500/30">{error}</p>}
      <div className="mt-2 flex gap-1.5">
        <button
          disabled={!dirty}
          onClick={applyDraft}
          className={`${btn} flex-1 bg-sky-500/15 py-1.5 text-sky-100 ring-sky-500/40 hover:bg-sky-500/25`}
        >Apply & rerun</button>
        <button disabled={!dirty} onClick={revertDraft} className={`${btn} bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]`}>Revert</button>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
        Applying reruns the whole shift and restarts the clock. No station cycle times are known, so output is material-feasible production, not verified throughput.
      </p>
    </Section>
  )
}
