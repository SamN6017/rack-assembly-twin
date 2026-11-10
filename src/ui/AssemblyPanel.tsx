import { LINE_STATIONS, N_STATIONS, racksAt, rateLastHour, stationAt, WORKERS_PER_STATION, type StationState } from '../sim/assemblyLine'
import { simClock, useSim, type Speed } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { Row, Section } from './common'
import { useSimTime } from './useSimTime'

const SPEEDS: Speed[] = [1, 2, 5, 10]
const DOT: Record<StationState, string> = {
  assembling: 'bg-emerald-400', transfer: 'bg-sky-400', waiting: 'bg-amber-400', blocked: 'bg-red-500', empty: 'bg-neutral-600',
}
const STATE_WORD: Record<StationState, string> = { assembling: 'assembling', transfer: 'rack moving', waiting: 'waiting', blocked: 'short of material', empty: 'empty' }

/**
 * Assembly line control panel: line status and output, playback, camera modes and a station
 * picker. Everything reads the same simulation as the dashboard; nothing here keeps its own timers.
 */
export function AssemblyPanel() {
  useSimTime(250)
  const t = simClock.t
  const { result, snapshot, running, speed, play, pause, reset, setSpeed } = useSim()
  const { cameraMode, enterWalk, setCamera, focusStation, followRack, selected } = useUi()
  const racks = racksAt(result, t)
  const inProduction = racks.filter((v) => v.state !== 'COMPLETED').length
  const stations = LINE_STATIONS.map((_, k) => stationAt(result, k, t))
  const status = snapshot.line.blocked ? 'Blocked' : running ? 'Running' : t >= result.horizon ? 'Shift ended' : 'Paused'
  const tone = status === 'Blocked' ? 'bg-red-500/15 text-red-200 ring-red-500/40' : status === 'Running' ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40' : 'bg-amber-500/15 text-amber-200 ring-amber-500/40'
  const btn = 'rounded px-2 py-1.5 text-xs ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  const idle = `${btn} bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]`
  const on = `${btn} bg-sky-500/15 text-sky-200 ring-sky-500/40`
  const selectedRack = selected?.startsWith('linerack:') ? selected : null
  const newest = racks.filter((v) => v.station !== null).sort((a, b) => b.rack - a.rack)[0]

  return (
    <Section title="Assembly line" right={<span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase ring-1 ${tone}`}>{status}</span>}>
      <Row label="Line stations" value={`${N_STATIONS} + sub-assembly`} />
      <Row label="Workers" value={`${N_STATIONS * WORKERS_PER_STATION} (${WORKERS_PER_STATION} per station)`} />
      <Row label="Racks in production" value={inProduction} />
      <Row label="Racks completed" value={snapshot.racksCompleted} />
      <Row label="Output, last hour" value={`${rateLastHour(result, t)} racks/h`} />
      <Row label="Transfer / assembly" value={`${Math.round(result.transferS)} s / ${Math.round(result.assemblyS / 60)} min`} confidence="placeholder" />

      <div className="mt-2 flex gap-1.5">
        <button onClick={running ? pause : play} className={`${btn} min-w-16 ${running ? 'bg-amber-500/15 text-amber-200 ring-amber-500/40' : 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40'}`}>
          {running ? 'Pause' : t > 0 ? 'Resume' : 'Start'}
        </button>
        <button onClick={reset} className={idle}>Reset</button>
        <div className="ml-auto flex overflow-hidden rounded ring-1 ring-white/10">
          {SPEEDS.map((s) => <button key={s} onClick={() => setSpeed(s)} className={`px-2 py-1.5 text-xs ${speed === s ? 'bg-sky-500/20 text-sky-200' : 'text-neutral-400 hover:bg-white/5'}`}>{s}×</button>)}
        </div>
      </div>

      <div className="mt-2 text-[10px] uppercase tracking-wider text-neutral-500">Stations</div>
      <div className="mt-1 grid grid-cols-5 gap-1">
        {stations.map((s) => (
          <button
            key={s.id}
            onClick={() => focusStation(s.id)}
            title={`${LINE_STATIONS[s.station].label}: ${STATE_WORD[s.state]}${s.rack ? ` · ${s.rack.id}` : ''}`}
            className={`flex flex-col items-center justify-center rounded py-1 text-[11px] leading-tight ring-1 ${selected === `station:${s.id}` ? 'bg-sky-500/15 text-sky-100 ring-sky-500/50' : 'bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]'}`}
          >
            <span className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${DOT[s.state]}`} />{s.station + 1}</span>
            <span className="text-[10px] text-neutral-400">{LINE_STATIONS[s.station].name.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      <div className="mt-2 text-[10px] uppercase tracking-wider text-neutral-500">Camera</div>
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        <button onClick={() => setCamera('iso')} className={cameraMode === 'overview' ? on : idle}>Factory overview</button>
        <button onClick={enterWalk} className={cameraMode === 'walk' ? on : idle}>First-person walk</button>
        <button onClick={() => selectedRack && followRack(selectedRack)} disabled={!selectedRack} className={cameraMode === 'rack' && selectedRack ? on : idle} title={selectedRack ? '' : 'Click a rack first'}>Follow selected rack</button>
        <button onClick={() => newest && followRack(`linerack:${newest.rack}`)} disabled={!newest} className={idle}>Follow newest rack</button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        Racks ride an indexing conveyor: all move together each takt, then each station assembles for the rest of it. Conveyor speeds and the split between transfer and assembly are placeholders; station cycle times are not in the sources.
      </p>
    </Section>
  )
}
