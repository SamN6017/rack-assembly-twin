import { useEffect, useState } from 'react'
import { LINE_STATIONS, RACK_STATE_LABEL, stationAt } from '../sim/assemblyLine'
import { walkSettings, walkState } from '../scene/FirstPerson'
import { simClock, useSim } from '../store/simStore'
import { displayLevel, useUi } from '../store/uiStore'
import { WALK_SPEEDS, type WalkSpeed } from '../sim/walk'
import { dur } from './kanbanUi'

const NEAR = 5

const STATE_TEXT = { assembling: 'Assembling', transfer: 'Rack moving in', waiting: 'Done, waiting for transfer', blocked: 'Stopped: short of material', empty: 'No rack' } as const
const STATE_TONE = { assembling: 'text-emerald-300', transfer: 'text-sky-300', waiting: 'text-amber-300', blocked: 'text-red-300', empty: 'text-neutral-400' } as const

/** Overlay for the first-person walkthrough: how to start, controls, crosshair, nearest station. */
export function WalkHud() {
  const mode = useUi((s) => s.cameraMode)
  const locked = useUi((s) => s.walkLocked)
  const exitWalk = useUi((s) => s.exitWalk)
  const result = useSim((s) => s.result)
  const [, tick] = useState(0)
  const [sens, setSens] = useState(walkSettings.sensitivity)
  const [speed, setSpeed] = useState<WalkSpeed>(walkSettings.speed)
  const level = useUi(displayLevel)
  useEffect(() => {
    if (mode !== 'walk') return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [mode])
  if (mode !== 'walk') return null

  const near = LINE_STATIONS
    .map((s, k) => ({ k, d: Math.hypot(s.rack.x - walkState.x, s.rack.z - walkState.z) }))
    .filter((x) => x.d < NEAR)
    .sort((a, b) => a.d - b.d)[0]
  const st = near ? stationAt(result, near.k, simClock.t) : null

  return (
    <>
      {locked && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/70" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/70" />
        </div>
      )}
      {st && (
        <div className="pointer-events-none absolute bottom-14 left-1/2 w-72 -translate-x-1/2 rounded-md bg-black/70 px-3 py-2 text-[12px] text-neutral-200 ring-1 ring-white/15 backdrop-blur">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-neutral-100">{st.id}</span>
            <span className={STATE_TONE[st.state]}>{STATE_TEXT[st.state]}</span>
          </div>
          {level !== 'minimal' && st.rack && <div className="mt-0.5 flex justify-between font-mono text-[11px] text-neutral-300"><span>{st.rack.id} · {st.rack.model}</span>{level === 'detailed' && <span>{RACK_STATE_LABEL[st.rack.state]}</span>}</div>}
          {level === 'detailed' && st.remaining !== null && <div className="font-mono text-[11px] text-neutral-400">{dur(st.remaining)} left in the assembly window (placeholder timing)</div>}
          {st.short.length > 0 && <div className="text-[11px] text-red-300">Waiting for {st.short.map((k) => k.split(':')[1]).join(', ')}</div>}
          <div className="mt-0.5 text-[10px] text-neutral-500">E · station details</div>
        </div>
      )}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md bg-black/70 px-3 py-1.5 text-[11px] text-neutral-300 ring-1 ring-white/15 backdrop-blur">
        <span>{locked ? 'WASD walk · Shift sprint · mouse look · E details · Esc release mouse' : 'Click the view to look around · WASD walk · Shift sprint'}</span>
        <label className="flex items-center gap-1 text-neutral-400" title="Walking speed (Shift doubles it)">
          speed
          <select
            value={speed}
            onChange={(e) => { walkSettings.speed = e.target.value as WalkSpeed; setSpeed(walkSettings.speed) }}
            className="rounded bg-neutral-900 px-1 py-px text-neutral-100 ring-1 ring-white/15"
          >
            {(Object.keys(WALK_SPEEDS) as WalkSpeed[]).map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)} · {WALK_SPEEDS[k]} m/s</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-neutral-400" title="Mouse sensitivity">
          look
          <input
            type="range" min={0.0008} max={0.005} step={0.0002} value={sens}
            onChange={(e) => { walkSettings.sensitivity = Number(e.target.value); setSens(walkSettings.sensitivity) }}
            className="w-16 accent-sky-500"
          />
        </label>
        <button onClick={exitWalk} className="rounded bg-white/10 px-2 py-0.5 text-neutral-100 ring-1 ring-white/20 hover:bg-white/20">Exit walkthrough</button>
      </div>
    </>
  )
}
