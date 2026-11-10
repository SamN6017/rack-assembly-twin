import { getPart } from '../data/parts'
import { LINE_STATIONS, partLabel, RACK_STATE_LABEL, rackAt, rackComponents, stationAt, stationParts, type StationState } from '../sim/assemblyLine'
import { formatClock, simClock, useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { stationLabel } from '../layout/factoryLayout'
import { Row, Section } from './common'
import { DueTag, dur, openCycle, StateChip } from './kanbanUi'
import { boardCards } from '../sim/boardCards'
import { useSimTime } from './useSimTime'

const WORKER_STATUS: Record<StationState, string> = {
  assembling: 'Working', transfer: 'Standing clear (rack moving)', waiting: 'Idle, waiting for transfer', blocked: 'Idle, station short of material', empty: 'Idle, no rack',
}
const STATION_STATUS: Record<StationState, string> = {
  assembling: 'Assembling', transfer: 'Rack transferring in', waiting: 'Complete, waiting for transfer', blocked: 'Blocked: material short', empty: 'No rack',
}

function Bar({ value }: { value: number }) {
  return (
    <span className="inline-block h-1.5 w-24 overflow-hidden rounded bg-white/10 align-middle">
      <span className="block h-full bg-sky-400/80" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  )
}

/** Rack information panel: identity, where it is, progress, installed and pending components. */
export function RackInfo({ rackNo }: { rackNo: number }) {
  useSimTime(250)
  const t = simClock.t
  const result = useSim((s) => s.result)
  const followRack = useUi((s) => s.followRack)
  const follow = useUi((s) => s.follow)
  const v = rackAt(result, rackNo, t)
  if (!v) return <Section title="GPU rack"><p className="text-[12px] text-neutral-500">This rack is no longer on the floor (shipped from staging) or not built yet.</p></Section>
  const { installed, pending } = rackComponents(v)
  const where = v.station !== null ? LINE_STATIONS[v.station].label : v.state === 'COMPLETED' ? 'Finished-rack staging' : 'Outfeed to staging'
  const id = `linerack:${rackNo}`
  return (
    <>
      <Section title="Rack" right={<button onClick={() => followRack(id)} disabled={follow === id} className="rounded px-1.5 py-0.5 text-[11px] text-neutral-300 ring-1 ring-white/15 hover:bg-white/5 disabled:text-sky-300 disabled:ring-sky-500/40">{follow === id ? 'Rack follow on' : 'Rack follow'}</button>}>
        <Row label="Rack ID" value={v.id} />
        <Row label="Model" value={v.model} confidence="placeholder" />
        <Row label="Current location" value={where} />
        <Row label="Status" value={<span className={v.state === 'COMPLETED' || v.state === 'PACKOUT_COMPLETE' ? 'text-emerald-300' : v.state === 'WAITING_FOR_TRANSFER' ? 'text-amber-300' : ''}>{RACK_STATE_LABEL[v.state]}</span>} />
        <Row label="Assembly progress" value={<><Bar value={v.progress} /> {Math.round(v.progress * 100)}%</>} />
        <Row label="At this station" value={v.atStationSince !== null ? dur(t - v.atStationSince) : '—'} />
        <Row label="Total elapsed" value={v.createdAt !== null ? dur((v.completedAt ?? t) - v.createdAt) : `${dur(t)}+ (on line at shift start)`} />
        {v.completedAt !== null && <Row label="Completed at" value={formatClock(v.completedAt)} />}
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">Model drawn from the {Math.round(result.config.bloomShare * 100)}% Bloom mix (placeholder). Progress counts finished stations equally, plus the share of the current assembly window.</p>
      </Section>
      <Section title={`Installed (${installed.length} station${installed.length === 1 ? '' : 's'})`}>
        {installed.length === 0 && <p className="text-[12px] text-neutral-500">Nothing yet: station 1 is still building the chassis.</p>}
        <StationList rows={installed} done />
      </Section>
      <Section title={`Pending (${pending.length})`}>
        {pending.length === 0 && <p className="text-[12px] text-emerald-300">Fully assembled.</p>}
        <StationList rows={pending} />
      </Section>
    </>
  )
}

function StationList({ rows, done }: { rows: { station: string; parts: ReturnType<typeof stationParts> }[]; done?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.station} className="text-[12px]">
          <span className={done ? 'text-emerald-300' : 'text-neutral-400'}>{done ? '✓' : '○'} {stationLabel(r.station)}</span>
          <span className="ml-2 text-neutral-300">
            {r.parts.length ? r.parts.map((p) => partLabel(p.pn)).join(', ') : <span className="text-neutral-500">{r.station === 'ST4' ? 'test only, no parts' : 'no pallet parts listed'}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Assembly section of the workstation panel: rack, workers, status, materials. */
export function StationAssembly({ stationId }: { stationId: string }) {
  useSimTime(250)
  const t = simClock.t
  const result = useSim((s) => s.result)
  const pou = useSim((s) => s.snapshot.pou)
  const select = useUi((s) => s.select)
  const k = LINE_STATIONS.findIndex((s) => s.id === stationId)
  if (k < 0) return null
  const st = stationAt(result, k, t)
  const model = st.rack?.model
  const parts = model ? stationParts(stationId, model) : []
  return (
    <Section title="Assembly">
      <div className="flex items-center justify-between py-1 text-[13px]">
        <span className="text-neutral-400">Current rack</span>
        {st.rack ? <button onClick={() => select(`linerack:${st.rack!.rack}`)} className="font-mono text-sky-300 hover:underline">{st.rack.id} · {st.rack.model}</button> : <span className="text-neutral-500">none</span>}
      </div>
      <Row label="Assembly status" value={<span className={st.state === 'blocked' ? 'text-red-300' : st.state === 'assembling' ? 'text-emerald-300' : st.state === 'waiting' ? 'text-amber-300' : ''}>{STATION_STATUS[st.state]}</span>} />
      {st.state === 'assembling' && <Row label="Progress" value={<><Bar value={st.progress} /> {Math.round(st.progress * 100)}%</>} />}
      <Row label="Time remaining" value={st.remaining !== null ? dur(st.remaining) : '—'} confidence="placeholder" />
      <Row label="Worker A (POU side)" value={<span className="font-sans text-[12px]">{WORKER_STATUS[st.state]}</span>} />
      <Row label="Worker B (bench side)" value={<span className="font-sans text-[12px]">{WORKER_STATUS[st.state]}</span>} />
      <div className="mt-1.5 text-[10px] uppercase tracking-wider text-neutral-500">Required materials{model ? ` (${model})` : ''}</div>
      {parts.length === 0 && <p className="text-[11px] text-neutral-500">{LINE_STATIONS[k].steps.length === 0 ? 'Testing fits no parts: the sheet has no rows for it. Its time uses the takt (placeholder).' : 'No pallet parts for this model.'}</p>}
      <ul className="mt-0.5 space-y-0.5">
        {parts.map((p) => {
          const key = `${p.station === 'SUBASSY' ? 'SUBASSY' : stationId}:${p.pn}`
          const have = pou.get(key)
          const missing = st.short.includes(key)
          return (
            <li key={p.pn} className="flex items-center justify-between gap-2 text-[12px]">
              <span className={missing ? 'text-red-300' : 'text-neutral-300'}>{partLabel(p.pn)}</span>
              <span className={`font-mono text-[11px] ${missing ? 'text-red-300' : 'text-neutral-500'}`}>{have === undefined ? 'not simulated' : missing ? `short · ${have} at POU` : `${have} at POU`}</span>
            </li>
          )
        })}
      </ul>
      {st.short.length > 0 && <p className="mt-1 text-[11px] text-red-300">Missing: {st.short.map((key) => getPart(key.split(':')[1]).description).join(', ')}. The line waits until the pallet arrives.</p>}
    </Section>
  )
}

/** Physical Kanban board: the cards on it, read from the digital card states (no separate state). */
export function BoardPanel() {
  useSimTime(500)
  const t = simClock.t
  const result = useSim((s) => s.result)
  const snapshot = useSim((s) => s.snapshot)
  const ui = useUi()
  const cards = boardCards(result, snapshot, t)
  const today = cards.filter((c) => c.row === 'today').sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  const filed = cards.filter((c) => c.row === 'filed')
  const slotLabel = (p: number) => `${String(p * 2).padStart(2, '0')}–${String(p * 2 + 2).padStart(2, '0')} h`
  return (
    <Section title="Board" right={<button onClick={() => { ui.setExpanded(false); ui.setTab('kanban') }} className="rounded px-1.5 py-0.5 text-[11px] text-sky-300 ring-1 ring-sky-500/40 hover:bg-sky-500/10">Open Kanban Board tab</button>}>
      <p className="mb-1.5 text-[11px] leading-relaxed text-neutral-500">Top row: today, 12 two-hour pockets; each card out on the replenishment loop sits in the pocket of its due time. Lower row: refilled Kanbans whose card DSV files at the next inspection. Colours match the Kanban Board tab.</p>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">Today row ({today.length})</div>
      {today.length === 0 && <p className="text-[12px] text-neutral-500">No cards out: every Kanban is full or in use.</p>}
      <ul className="mt-0.5 space-y-1">
        {today.map((c) => {
          const [pn, k] = c.slotId.split('#')
          const cyc = openCycle(result, c.slotId, t)
          return (
            <li key={c.slotId} className="flex items-center justify-between gap-2 text-[12px]">
              <button onClick={() => ui.select(`kanban:${c.slotId}:0`, { focus: true })} className="truncate text-left text-neutral-200 hover:underline" title={pn}>
                {getPart(pn).description} <span className="text-neutral-500">K{Number(k) + 1}</span>
              </button>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="font-mono text-[10px] text-neutral-500">{slotLabel(c.pocket)}</span>
                <StateChip state={c.state} />
                {cyc && <DueTag cycle={cyc} t={t} />}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-2 text-[10px] uppercase tracking-wider text-neutral-500">To be filed ({filed.length})</div>
      <ul className="mt-0.5 space-y-1">
        {filed.map((c) => <li key={c.slotId} className="flex justify-between text-[12px] text-neutral-300"><span>{getPart(c.slotId.split('#')[0]).description} K{Number(c.slotId.split('#')[1]) + 1}</span><StateChip state={c.state} /></li>)}
      </ul>
      <p className="mt-2 text-[11px] text-neutral-500">Next inspection {formatClock(Math.floor(t / (result.config.inspectionIntervalMin * 60) + 1) * result.config.inspectionIntervalMin * 60)} (every {result.config.inspectionIntervalMin} min).</p>
    </Section>
  )
}
