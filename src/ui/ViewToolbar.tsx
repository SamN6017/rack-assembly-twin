import { useEffect, useState } from 'react'
import { LINE_STATIONS } from '../sim/assemblyLine'
import { walkState } from '../scene/FirstPerson'
import { simClock, useSim, type Speed } from '../store/simStore'
import { displayLevel, useUi, type DisplayLevel } from '../store/uiStore'
import { Details } from './Details'
import { formatClock } from '../store/simStore'
import { useSimTime } from './useSimTime'

const SPEEDS: Speed[] = [1, 2, 5, 10]
const LEVELS: { id: DisplayLevel; label: string; title: string }[] = [
  { id: 'minimal', label: 'Min', title: 'Minimal: station identifiers, the selection and critical alerts' },
  { id: 'standard', label: 'Std', title: 'Standard: station and area labels, status indicators' },
  { id: 'detailed', label: 'Det', title: 'Detailed: rack IDs, station states, handler status, inventory' },
]

const group = 'flex overflow-hidden rounded ring-1 ring-white/15'
const seg = (on: boolean) => `px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${on ? 'bg-sky-500/25 text-sky-100' : 'text-neutral-300 hover:bg-white/10'}`
const solo = 'rounded px-2 py-1 text-[11px] text-neutral-200 ring-1 ring-white/15 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40'

/** Station the walker is looking at (within 5 m, in front), else the nearest within 5 m. */
function stationInView(): string | null {
  const fx = -Math.sin(walkState.yaw), fz = -Math.cos(walkState.yaw)
  let best: { id: string; score: number } | null = null
  for (const s of LINE_STATIONS) {
    const dx = s.rack.x - walkState.x, dz = s.rack.z - walkState.z
    const d = Math.hypot(dx, dz)
    if (d > 5) continue
    const facing = d > 0.1 ? (dx * fx + dz * fz) / d : 1
    const score = d - facing * 3
    if (!best || score < best.score) best = { id: s.id, score }
  }
  return best?.id ?? null
}

/**
 * Floating toolbar over the 3D view: camera mode, playback, display level, expand / restore and
 * browser fullscreen. In the expanded layout it is the only chrome, plus a details drawer for the
 * selection (in the walkthrough, E opens the station you are looking at).
 */
export function ViewToolbar() {
  useSimTime(500)
  const ui = useUi()
  const { running, speed, play, pause, setSpeed, result } = useSim()
  const [drawer, setDrawer] = useState(true)
  const [fs, setFs] = useState(false)
  const level = displayLevel(ui)
  const walking = ui.cameraMode === 'walk'

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // E in the walkthrough: open (or close) the details of the station in view.
  useEffect(() => {
    if (!walking) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyE' || e.repeat || e.target instanceof HTMLInputElement) return
      const id = stationInView()
      const s = useUi.getState()
      if (id && s.selected !== `station:${id}`) { s.select(`station:${id}`); setDrawer(true) }
      else s.select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [walking])

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else {
        await document.documentElement.requestFullscreen()
        ui.setExpanded(true)
      }
    } catch {
      // Fullscreen refused (iframe, policy): the in-app expanded layout still works.
      ui.setExpanded(true)
    }
  }

  return (
    <>
      <div className="pointer-events-auto absolute right-2 top-2 z-30 flex flex-wrap items-center justify-end gap-1.5 rounded-md bg-neutral-950/80 p-1.5 shadow-lg ring-1 ring-white/10 backdrop-blur" role="toolbar" aria-label="3D view controls">
        <div className={group} role="group" aria-label="Camera mode">
          <button className={seg(ui.cameraMode === 'overview' || ui.cameraMode === 'station')} onClick={() => ui.setCamera('iso')} title="Factory overview">Overview</button>
          <button className={seg(walking)} onClick={ui.enterWalk} title="First-person walkthrough">Walk</button>
          <button
            className={seg(ui.cameraMode === 'rack')}
            disabled={!ui.selected?.startsWith('linerack:')}
            onClick={() => ui.selected && ui.followRack(ui.selected)}
            title={ui.selected?.startsWith('linerack:') ? 'Follow the selected rack' : 'Select a rack to follow it'}
          >Follow rack</button>
        </div>
        <button className={solo} onClick={running ? pause : play} aria-label={running ? 'Pause simulation' : 'Start simulation'}>{running ? 'Pause' : simClock.t > 0 ? 'Resume' : 'Start'}</button>
        <span className="font-mono text-[11px] text-neutral-400" aria-label="Simulation time">{formatClock(simClock.t)}</span>
        <div className={group} role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => <button key={s} className={seg(speed === s)} onClick={() => setSpeed(s)} aria-pressed={speed === s}>{s}×</button>)}
        </div>
        <div className={group} role="group" aria-label="Display level">
          {LEVELS.map((l) => <button key={l.id} className={seg(level === l.id)} onClick={() => ui.setDetail(l.id)} title={l.title} aria-pressed={level === l.id}>{l.label}</button>)}
        </div>
        <button className={solo} onClick={() => ui.setExpanded(!ui.expanded)} title={ui.expanded ? 'Restore the dashboard layout' : 'Expand the 3D view'} aria-pressed={ui.expanded}>{ui.expanded ? 'Restore' : 'Expand'}</button>
        <button className={solo} onClick={toggleFullscreen} title="Browser fullscreen">{fs ? 'Exit fullscreen' : 'Fullscreen'}</button>
        {walking && <button className={`${solo} bg-white/10`} onClick={ui.exitWalk}>Exit walk</button>}
      </div>

      {ui.expanded && ui.selected && drawer && (
        <div className="pointer-events-auto absolute bottom-16 right-2 top-14 z-30 flex w-[330px] flex-col overflow-hidden rounded-md bg-[#111214]/95 shadow-xl ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-[11px] text-neutral-400">
            <span>Details{walking ? ' · E to close' : ''}</span>
            <button onClick={() => setDrawer(false)} className="rounded px-1.5 text-neutral-300 hover:bg-white/10" aria-label="Hide details">✕</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto"><Details id={ui.selected} /></div>
        </div>
      )}
      {ui.expanded && ui.selected && !drawer && (
        <button onClick={() => setDrawer(true)} className={`${solo} pointer-events-auto absolute right-2 top-14 z-30 bg-neutral-950/80`}>Show details</button>
      )}
      {ui.expanded && !walking && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-20 rounded bg-neutral-950/70 px-2 py-1 text-[11px] text-neutral-400 ring-1 ring-white/10">
          {result.config.ratePerHour} racks/h · {useSim.getState().snapshot.racksCompleted} completed · click a rack or station for details
        </div>
      )}
    </>
  )
}
