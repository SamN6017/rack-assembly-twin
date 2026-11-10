import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import type { Confidence } from '../data/parts'
import { LAYOUT, type Rect } from '../layout/factoryLayout'
import { LINE_STATIONS, stationAt } from '../sim/assemblyLine'
import { declutter, lineOfSight, walkLabelVisible, type ScreenRect } from '../sim/labelVisibility'
import { simClock, useSim } from '../store/simStore'
import { displayLevel, useUi } from '../store/uiStore'

const centre = (r: Rect): [number, number] => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]

type Kind = 'zone' | 'station' | 'board' | 'line'
interface Tag { id: string; text: string; x: number; z: number; y: number; kind: Kind; confidence: Confidence; station?: number }

function tags(): Tag[] {
  const L = LAYOUT
  const z = L.zones
  const out: Tag[] = [
    { id: 'kanban', text: 'Kanban area · "Blue Box"', x: centre(L.kanbanArea)[0], z: L.kanbanArea.minZ - 1.6, y: 0.4, kind: 'zone', confidence: 'verified' },
    { id: 'm-aisle', text: 'M-shelf aisle', x: centre(L.middleAisle)[0], z: centre(L.middleAisle)[1], y: 0.4, kind: 'zone', confidence: 'verified' },
    { id: 'dsv', text: 'DSV warehouse (illustrative)', x: centre(z.dsvRacking)[0], z: z.dsvRacking.minZ - 2, y: 7, kind: 'zone', confidence: 'placeholder' },
    { id: 'dsv-stage', text: 'DSV staging', x: centre(z.dsvStaging)[0], z: z.dsvStaging.minZ - 0.8, y: 0.4, kind: 'zone', confidence: 'estimated' },
    { id: 'handler', text: 'Material handler floor', x: centre(z.handlerFloor)[0], z: 46, y: 0.4, kind: 'zone', confidence: 'estimated' },
    { id: 'finished', text: 'Finished rack staging', x: centre(z.finishedStaging)[0], z: z.finishedStaging.minZ - 1, y: 3, kind: 'zone', confidence: 'estimated' },
    { id: 'main', text: 'Main aisle', x: centre(z.mainAisle)[0], z: 53, y: 0.4, kind: 'zone', confidence: 'estimated' },
    { id: 'board', text: 'Kanban board', x: L.kanbanBoard.x, z: L.kanbanBoard.z, y: 2.6, kind: 'board', confidence: 'verified' },
    { id: 'cls-park', text: 'CLS handler bays', x: 38.6, z: L.parkingSpots[0].z - 1.5, y: 1.2, kind: 'zone', confidence: 'estimated' },
    { id: 'twobin', text: 'Small parts 2-bin', x: L.smallPartsRacks[0].x - 1, z: L.smallPartsRacks[0].z, y: 2.4, kind: 'zone', confidence: 'verified' },
    { id: 'subassy', text: 'Sub-assembly', x: L.stations.find((s) => s.id === 'SUBASSY')!.rack.x, z: L.stations.find((s) => s.id === 'SUBASSY')!.rack.z, y: 2.9, kind: 'zone', confidence: 'estimated' },
  ]
  const first = LINE_STATIONS[0].rack, last = LINE_STATIONS[LINE_STATIONS.length - 1].rack
  // Shown instead of eight station tags when the camera is far enough that they would pile up.
  out.push({ id: 'line', text: `Assembly line · ${LINE_STATIONS.length} stations`, x: first.x, z: (first.z + last.z) / 2, y: 3.4, kind: 'line', confidence: 'verified' })
  LINE_STATIONS.forEach((s, k) => out.push({ id: s.id, text: s.label, x: s.rack.x, z: s.rack.z, y: 2.9, kind: 'station', confidence: s.confidence, station: k }))
  return out
}

const TAGS = tags()
const DOT: Record<Confidence, string> = { verified: 'bg-emerald-400', estimated: 'bg-amber-400', placeholder: 'bg-neutral-400' }
const STATE_WORD = { assembling: 'assembling', transfer: 'rack moving', waiting: 'waiting', blocked: 'SHORT', empty: 'empty' } as const

/** Overview: beyond this camera distance station tags give way to the single line tag. */
const STATION_FAR = 85
const ZONE_FAR = 260
const ZONE_NEAR = 45
const LOW_CAMERA = 8
// With a handler here, drei leaves the element's display alone (it would otherwise re-show a label
// coming back in front of the camera); visibility is decided only by the pass below.
const keepDisplay = () => {}
const TICK = 0.12   // seconds between visibility passes (labels need no per-frame checks)

/**
 * Floating labels, camera-mode aware.
 * - Overview: zone and station tags (minimal: stations only), culled off-screen, hidden behind
 *   geometry, and decluttered by priority so tags never overlap; far out, the eight station tags
 *   collapse to one line tag; near the floor, only nearby area tags show.
 * - First-person: only labels within ~6 m, in front of the viewer and in line of sight (layout
 *   occlusion test, with distance hysteresis), nearest and most central first.
 * Detailed level adds each station's rack and state to its tag. Hidden labels stay mounted (each
 * drei Html is its own React root; unmounting them mid-render throws) and never take pointer input.
 */
export function Labels() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const result = useSim((s) => s.result)
  const els = useRef<(HTMLDivElement | null)[]>([])
  const texts = useRef<(HTMLSpanElement | null)[]>([])
  const shown = useRef<boolean[]>(TAGS.map(() => false))
  const acc = useRef(TICK)
  const v = useRef({ p: new THREE.Vector3(), f: new THREE.Vector3() })

  useFrame((_, delta) => {
    acc.current += delta
    if (acc.current < TICK) return
    acc.current = 0
    const ui = useUi.getState()
    const walking = ui.cameraMode === 'walk'
    const level = displayLevel(ui)
    const enabled = ui.layers.labels && (walking || ui.tab === 'factory')
    const eye = camera.position
    const fwd = camera.getWorldDirection(v.current.f)
    const want: boolean[] = TAGS.map(() => false)
    const rects: (ScreenRect | null)[] = TAGS.map(() => null)
    const score: number[] = TAGS.map(() => Infinity)

    if (enabled) {
      for (let i = 0; i < TAGS.length; i++) {
        const t = TAGS[i]
        const d = Math.hypot(t.x - eye.x, t.y - eye.y, t.z - eye.z)
        let ok: boolean
        if (walking) {
          const allowed = t.kind === 'station' || (level !== 'minimal' && (t.kind === 'zone' || t.kind === 'board'))
          ok = allowed && walkLabelVisible(eye, fwd, t, shown.current[i])
        } else {
          if (t.kind === 'station') ok = d < STATION_FAR * (shown.current[i] ? 1.08 : 1)
          else if (t.kind === 'line') ok = d >= STATION_FAR
          // Close to the floor (workstation close-up) only nearby areas are worth a tag.
          else ok = level !== 'minimal' && d < (eye.y < LOW_CAMERA ? ZONE_NEAR : ZONE_FAR)
          // Never through geometry: from low or behind racking, hidden tags stay hidden.
          ok = ok && lineOfSight(eye, t)
        }
        if (!ok) continue
        // On screen?
        const p = v.current.p.set(t.x, t.y, t.z).project(camera)
        if (p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) continue
        const el = els.current[i]
        const w = el?.offsetWidth || t.text.length * 6.5 + 24
        const h = el?.offsetHeight || 20
        const sx = (p.x * 0.5 + 0.5) * size.width, sy = (-p.y * 0.5 + 0.5) * size.height
        rects[i] = { x: sx - w / 2, y: sy - h / 2, w, h }
        want[i] = true
        // Priority: stations, then the board and the line, then zones; nearer and more central first.
        const tier = t.kind === 'station' ? 0 : t.kind === 'board' || t.kind === 'line' ? 1 : 2
        score[i] = tier * 1e6 + d + (walking ? Math.hypot(p.x, p.y) * 20 : 0)
      }
    }
    const order = TAGS.map((_, i) => i).filter((i) => want[i]).sort((a, b) => score[a] - score[b])
    const keep = declutter(rects, order)
    for (let i = 0; i < TAGS.length; i++) {
      const on = keep.has(i)
      shown.current[i] = on
      const el = els.current[i]
      if (el && (el.style.display === 'none') === on) el.style.display = on ? 'block' : 'none'
      // Detailed level: what each visible station is doing right now.
      const t = TAGS[i]
      const span = texts.current[i]
      if (on && span && t.station !== undefined) {
        let text = t.text
        if (level === 'detailed') {
          const st = stationAt(result, t.station, simClock.t)
          text = `${t.text} · ${st.rack ? st.rack.id : '—'} · ${STATE_WORD[st.state]}`
        }
        if (span.textContent !== text) span.textContent = text
      }
    }
  })

  return (
    <>
      {TAGS.map((t, i) => (
        <Html key={t.id} ref={(el) => { els.current[i] = el }} position={[t.x, t.y, t.z]} center zIndexRange={[20, 0]} onOcclude={keepDisplay} style={{ pointerEvents: 'none', display: 'none' }}>
          <div className={`flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium shadow-lg ring-1 ${t.kind === 'station' ? 'bg-sky-950/85 text-sky-100 ring-sky-500/40' : t.kind === 'line' ? 'bg-sky-950/85 text-sky-100 ring-sky-500/30' : 'bg-neutral-900/80 text-neutral-200 ring-white/10'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[t.confidence]}`} />
            <span ref={(el) => { texts.current[i] = el }}>{t.text}</span>
          </div>
        </Html>
      ))}
    </>
  )
}
