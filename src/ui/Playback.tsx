import { formatClock, useSim, type Speed } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { Row, Section } from './common'
import { dur } from './kanbanUi'
import { useSimTime } from './useSimTime'

const SPEEDS: Speed[] = [1, 2, 5, 10]

/** Clock, playback and headline results for the scenario on screen. */
export function Playback() {
  const t = useSimTime(200)
  const { running, speed, play, pause, reset, setSpeed, seek, result, config } = useSim()
  const { select, setFollow, follow } = useUi()
  const delivered = result.tasks.filter((x) => x.kind === 'pou-delivery' && x.deliveredAt <= t).length
  const refills = result.tasks.filter((x) => x.kind === 'kanban-refill' && x.deliveredAt <= t).length
  const active = result.tasks.filter((x) => x.dispatchedAt <= t && x.doneAt > t).length
  const snapshot = useSim((s) => s.snapshot)
  const starved = result.starvations.filter((x) => x.from <= t).length
  const stops = result.blocks.filter((b) => b.from <= t)
  const lost = stops.reduce((a, b) => a + Math.min(b.to ?? result.horizon, t) - b.from, 0)
  const target = Math.min(result.targetRacks, Math.floor(t / result.takt) + 1)
  const late = result.cycles.filter((c) => (c.replenishedAt ?? Infinity) > c.dueAt && c.dueAt <= t).length
  const btn = 'rounded px-2.5 py-1.5 text-xs ring-1 transition-colors'

  const followNext = () => {
    const ids = result.handlers.map((h) => `handler:${h.id}`)
    const next = ids[(ids.indexOf(follow ?? '') + 1) % ids.length]
    select(next)
    setFollow(next)
  }

  return (
    <Section title="Simulation" right={<span className="text-[10px] text-neutral-500">material flow · seed {config.seed}</span>}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-2xl tabular-nums text-neutral-100">{formatClock(t)}</span>
        <span className="font-mono text-[11px] text-neutral-500">/ {formatClock(result.horizon)}</span>
      </div>
      <div
        title="Click to jump to a time"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          seek(((e.clientX - r.left) / r.width) * result.horizon)
        }}
        className="group mb-2 cursor-pointer py-1"
      >
        <div className="h-1 overflow-hidden rounded bg-white/5 group-hover:h-1.5">
          <div className="h-full bg-sky-500/70" style={{ width: `${(t / result.horizon) * 100}%` }} />
        </div>
      </div>
      <div className="flex gap-1.5">
        <button onClick={running ? pause : play} className={`${btn} min-w-16 ${running ? 'bg-amber-500/15 text-amber-200 ring-amber-500/40' : 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40'}`}>
          {running ? 'Pause' : t > 0 ? 'Resume' : 'Start'}
        </button>
        <button onClick={reset} className={`${btn} bg-white/[0.03] text-neutral-300 ring-white/10 hover:bg-white/[0.07]`}>Reset</button>
        <div className="ml-auto flex overflow-hidden rounded ring-1 ring-white/10">
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={`px-2 py-1.5 text-xs ${speed === s ? 'bg-sky-500/20 text-sky-200' : 'text-neutral-400 hover:bg-white/5'}`}>{s}×</button>
          ))}
        </div>
      </div>
      <div className="mt-2.5">
        <Row label="Racks completed / target" value={<span className={snapshot.racksCompleted < target ? 'text-amber-300' : ''}>{snapshot.racksCompleted} / {target}</span>} />
        <Row label="Line" value={snapshot.line.blocked ? <span className="text-red-300">stopped</span> : <span className="text-emerald-300">{t >= result.horizon ? 'shift ended' : 'running'}</span>} />
        {config.shortage === 'block'
          ? <Row label="Lost to shortages" value={<span className={lost ? 'text-red-300' : ''}>{Math.round(lost / 60)} min · {stops.length} stops</span>} />
          : <Row label="Short racks (pass)" value={<span className={starved ? 'text-red-300' : ''}>{starved}</span>} />}
        <Row label="Pieces fitted" value={snapshot.consumed.toLocaleString()} />
        <Row label="Late Kanban refills" value={<span className={late ? 'text-amber-300' : ''}>{late}</span>} />
        <Row label="POU deliveries" value={delivered} />
        <Row label="Kanban refill trips" value={refills} />
        <Row label="Trips in progress" value={active} />
      </div>
      <button onClick={followNext} className={`${btn} mt-2 w-full bg-white/[0.03] text-left text-neutral-300 ring-white/10 hover:bg-white/[0.07]`}>
        {follow?.startsWith('handler:') ? `Following ${follow.slice(8)} — next handler` : 'Follow a material handler'}
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        Playback speed changes how fast simulated time passes, not what happens. The line indexes every takt ({dur(result.takt)} at {config.ratePerHour}/h) and stops while any station lacks parts for its rack.
      </p>
    </Section>
  )
}
