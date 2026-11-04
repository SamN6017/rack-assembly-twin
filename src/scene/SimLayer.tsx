import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import { getPart } from '../data/parts'
import { loadProfile } from '../assets/manifest'
import { LAYOUT } from '../layout/factoryLayout'
import { pointAt } from '../sim/path'
import { poseAt } from '../sim/movementSim'
import { simClock, useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { PalletLoads, type PalletLoad } from './Instanced'

/** Advances the simulation clock once per rendered frame. */
export function SimDriver() {
  const tick = useSim((s) => s.tick)
  useFrame((_, dt) => tick(dt))
  return null
}

/** Prepared replenishment pallets waiting in the DSV staging lane. */
export function StagingLane() {
  const stage = useSim((s) => s.snapshot.stage)
  const items = useMemo<PalletLoad[]>(() => stage.flatMap((pn, i) => {
    if (!pn) return []
    const p = LAYOUT.stagingSlots[i]
    return [{ x: p.x, z: p.z, rotY: Math.PI / 2, profile: loadProfile(getPart(pn)), id: `stage:${i}` }]
  }), [stage])
  return <PalletLoads items={items} />
}

const Y = 0.03

/**
 * Corridor network (the only places handlers drive) and, for the selected or followed handler,
 * the rest of its current trip.
 */
export function Routes() {
  const show = useUi((s) => s.layers.routes)
  const corridors = useMemo(() => LAYOUT.corridors.map((c) => [[c.a.x, Y, c.a.z], [c.b.x, Y, c.b.z]] as [number, number, number][]), [])
  return (
    <group visible={show}>
      {corridors.map((pts, i) => <Line key={i} points={pts} color="#22d3ee" lineWidth={1.2} transparent opacity={0.45} dashed dashSize={0.8} gapSize={0.5} />)}
      <ActiveTrip />
    </group>
  )
}

function ActiveTrip() {
  const result = useSim((s) => s.result)
  const focusId = useUi((s) => (s.follow?.startsWith('handler:') ? s.follow : s.selected?.startsWith('handler:') ? s.selected : null))
  const [trip, setTrip] = useState<{ key: string; pts: [number, number, number][] } | null>(null)
  const lastKey = useRef('')

  useFrame(() => {
    const h = focusId ? result.handlers.find((x) => `handler:${x.id}` === focusId) : undefined
    const taskId = h ? poseAt(h, simClock.t).taskId : null
    const key = `${focusId}|${taskId}`
    if (key === lastKey.current) return
    lastKey.current = key
    if (!h || !taskId) { setTrip(null); return }
    const pts: [number, number, number][] = []
    for (const seg of h.segs) {
      if (seg.taskId !== taskId || seg.kind !== 'move') continue
      for (let s = 0; s <= seg.path.length; s += 0.5) {
        const p = pointAt(seg.path, s)
        pts.push([p.x, Y + 0.02, p.z])
      }
      const e = pointAt(seg.path, seg.path.length)
      pts.push([e.x, Y + 0.02, e.z])
    }
    setTrip(pts.length > 1 ? { key, pts } : null)
  })

  if (!trip) return null
  return <Line key={trip.key} points={trip.pts} color="#fbbf24" lineWidth={3} />
}
