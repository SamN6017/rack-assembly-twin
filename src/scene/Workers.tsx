import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { LAYOUT, type WorkerSpot } from '../layout/factoryLayout'
import { LINE_STATIONS, stationAt, type StationState } from '../sim/assemblyLine'
import { simClock, useSim } from '../store/simStore'

/**
 * Two assembly workers per station (16 in all), procedural low-poly figures in PPE: hard hat,
 * safety glasses, hi-vis vest, gloves and safety boots. Their pose is a pure function of the
 * station state and simulation time, so pausing freezes them and playback speed scales them with
 * everything else. Working motion follows a fixed loop (fetch a part, carry, install, drive
 * fasteners, check); it is illustrative, not a timed work instruction.
 */

const SKIN = new THREE.MeshStandardMaterial({ color: '#c99a78', roughness: 0.8 })
const VEST = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.7 })
const STRIPE = new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.3, metalness: 0.4 })
const SHIRT = new THREE.MeshStandardMaterial({ color: '#2b3442', roughness: 0.85 })
const TROUSERS = new THREE.MeshStandardMaterial({ color: '#1f2733', roughness: 0.9 })
const BOOT = new THREE.MeshStandardMaterial({ color: '#191919', roughness: 0.8 })
const GLOVE = new THREE.MeshStandardMaterial({ color: '#3a6ea5', roughness: 0.8 })
const HAT = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.4 })
const GLASSES = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.2, metalness: 0.6 })
const TOOL = new THREE.MeshStandardMaterial({ color: '#e2661c', roughness: 0.5 })

const G = {
  leg: new THREE.BoxGeometry(0.13, 0.82, 0.15).translate(0, -0.41, 0),
  boot: new THREE.BoxGeometry(0.13, 0.09, 0.27).translate(0, -0.86, 0.05),
  torso: new THREE.BoxGeometry(0.38, 0.56, 0.22).translate(0, 0.28, 0),
  vest: new THREE.BoxGeometry(0.4, 0.42, 0.24).translate(0, 0.3, 0),
  stripe: new THREE.BoxGeometry(0.41, 0.035, 0.25).translate(0, 0.22, 0),
  neck: new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10).translate(0, 0.6, 0),
  head: new THREE.SphereGeometry(0.105, 16, 12).translate(0, 0.74, 0),
  hat: new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.79, 0),
  brim: new THREE.CylinderGeometry(0.15, 0.15, 0.012, 18).translate(0, 0.79, 0.02),
  glasses: new THREE.BoxGeometry(0.17, 0.035, 0.03).translate(0, 0.75, 0.095),
  upper: new THREE.BoxGeometry(0.1, 0.3, 0.1).translate(0, -0.15, 0),
  fore: new THREE.BoxGeometry(0.085, 0.27, 0.085).translate(0, -0.135, 0),
  hand: new THREE.BoxGeometry(0.08, 0.09, 0.05).translate(0, -0.31, 0),
  tool: new THREE.BoxGeometry(0.05, 0.05, 0.2).translate(0, -0.32, 0.08),
}

/** Joint angles (radians) and body offsets for one moment. */
interface Pose {
  turn: number      // whole-body yaw away from the rack (to fetch parts)
  lean: number      // forward bend at the hips
  step: number      // shift towards (+) or away from (−) the rack, metres
  shL: number; shR: number     // shoulder pitch: 0 = arm down, + = forward / up
  elL: number; elR: number     // elbow bend
  splay: number     // arms out to the side
  drive: number     // 1 while running the nutrunner (adds a small fast buzz)
  head: number      // head yaw
}

const REST: Pose = { turn: 0, lean: 0, step: 0, shL: 0.05, shR: 0.05, elL: 0.15, elR: 0.15, splay: 0.06, drive: 0, head: 0 }

/** Working loop (seconds into the cycle → pose). Worker A fetches from the POU behind them, B from the bench. */
const WORK: [number, Partial<Pose>][] = [
  [0.0, {}],
  [1.0, { turn: 2.6, lean: 0.15, head: 0.2 }],                                      // turn to the parts
  [2.2, { turn: 2.6, lean: 0.55, shL: 1.0, shR: 1.0, elL: 0.3, elR: 0.3 }],         // reach down, pick
  [3.4, { turn: 0.4, lean: 0.1, shL: 0.7, shR: 0.7, elL: 1.4, elR: 1.4 }],          // carry it back
  [4.6, { turn: 0, step: 0.12, lean: 0.12, shL: 1.45, shR: 1.35, elL: 0.6, elR: 0.7 }], // place it in the rack
  [6.0, { turn: 0, step: 0.12, lean: 0.1, shL: 1.35, shR: 1.25, elL: 0.8, elR: 0.9, head: -0.1 }],
  [6.6, { turn: 0, step: 0.1, shL: 0.9, shR: 1.3, elL: 1.2, elR: 0.9, drive: 1 }],  // drive fasteners
  [9.0, { turn: 0, step: 0.1, shL: 0.9, shR: 1.3, elL: 1.2, elR: 0.9, drive: 1, head: 0.15 }],
  [10.2, { turn: 0, step: 0.05, shL: 0.3, shR: 0.3, elL: 0.5, elR: 0.5, head: 0.3 }], // check
  [11.0, {}],
]
const CYCLE = 11

const IDLE_BY_STATE: Record<StationState, Partial<Pose>> = {
  assembling: {},
  transfer: { step: -0.22, head: 0.6 },                                    // stand clear while the rack moves
  waiting: { step: -0.08, shL: 0.35, shR: 0.35, elL: 1.9, elR: 1.9, splay: 0.02 },  // arms folded
  blocked: { step: -0.08, head: 1.1, shL: 0.15, shR: 0.15, elL: 0.6, elR: 0.6 },   // looking toward the POU
  empty: { step: -0.1 },
}

const smooth = (x: number) => x * x * (3 - 2 * x)
const mix = (a: Pose, b: Partial<Pose>, f: number): Pose => {
  const out = { ...a }
  for (const k of Object.keys(REST) as (keyof Pose)[]) out[k] = a[k] + ((b[k] ?? REST[k]) - a[k]) * f
  return out
}
const full = (p: Partial<Pose>): Pose => ({ ...REST, ...p })

function workPose(t: number): Pose {
  const c = ((t % CYCLE) + CYCLE) % CYCLE
  for (let i = 1; i < WORK.length; i++) {
    const [t1, p1] = WORK[i]
    const [t0, p0] = WORK[i - 1]
    if (c <= t1) return mix(full(p0), p1, smooth((c - t0) / (t1 - t0)))
  }
  return REST
}

/** Pose at simulation time t for a worker at a station in a given state. */
export function workerPose(state: StationState, t: number, since: number, phase: number): Pose {
  const breathe = Math.sin((t + phase * 7) * 1.3) * 0.02
  if (state === 'assembling') {
    // Start the loop when assembly starts; ease in from rest over the first second.
    const w = workPose(t - since + phase * CYCLE)
    return mix(REST, w, Math.min(1, (t - since) / 1))
  }
  const p = full(IDLE_BY_STATE[state])
  p.lean += breathe
  return p
}

interface Rig {
  root: THREE.Group; body: THREE.Group; head: THREE.Group
  shL: THREE.Group; shR: THREE.Group; elL: THREE.Group; elR: THREE.Group
  spot: WorkerSpot; phase: number; side: 1 | -1
}

function makeWorker(spot: WorkerSpot, hasTool: boolean): Rig {
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => { const x = new THREE.Mesh(g, m); x.castShadow = true; return x }
  const root = new THREE.Group()
  root.position.set(spot.x, 0, spot.z)
  root.rotation.y = spot.yaw
  // Legs stand at the root; the body above the hips turns and bends.
  for (const s of [-1, 1]) {
    const leg = new THREE.Group()
    leg.position.set(s * 0.09, 0.9, 0)
    leg.add(mesh(G.leg, TROUSERS), mesh(G.boot, BOOT))
    root.add(leg)
  }
  const body = new THREE.Group()
  body.position.y = 0.9
  root.add(body)
  body.add(mesh(G.torso, SHIRT), mesh(G.vest, VEST), mesh(G.stripe, STRIPE), mesh(G.neck, SKIN))
  const head = new THREE.Group()
  head.add(mesh(G.head, SKIN), mesh(G.hat, HAT), mesh(G.brim, HAT), mesh(G.glasses, GLASSES))
  body.add(head)
  const arm = (s: 1 | -1, tool: boolean) => {
    const sh = new THREE.Group()
    sh.position.set(s * 0.24, 0.52, 0)
    sh.add(mesh(G.upper, VEST))
    const el = new THREE.Group()
    el.position.y = -0.3
    el.add(mesh(G.fore, SHIRT), mesh(G.hand, GLOVE))
    if (tool) el.add(mesh(G.tool, TOOL))
    sh.add(el)
    body.add(sh)
    return { sh, el }
  }
  const L = arm(1, false), R = arm(-1, hasTool)
  return { root, body, head, shL: L.sh, shR: R.sh, elL: L.el, elR: R.el, spot, phase: spot.side === 'A' ? 0 : 0.43, side: spot.side === 'A' ? 1 : -1 }
}

function apply(r: Rig, p: Pose, t: number) {
  // A turns over its left shoulder toward the POU column, B over its right toward the bench.
  r.body.rotation.y = p.turn * r.side
  r.body.rotation.x = p.lean
  r.root.position.x = r.spot.x + Math.sin(r.spot.yaw) * p.step
  r.root.position.z = r.spot.z + Math.cos(r.spot.yaw) * p.step
  r.head.rotation.y = p.head * r.side
  const buzz = p.drive ? Math.sin(t * 40) * 0.03 : 0
  r.shL.rotation.set(-p.shL, 0, p.splay)
  r.shR.rotation.set(-p.shR + buzz, 0, -p.splay)
  r.elL.rotation.x = -p.elL
  r.elR.rotation.x = -p.elR - buzz
}

/** All 16 assembly workers, animated from the station states in one frame loop. */
export function Workers() {
  const result = useSim((s) => s.result)
  const rigs = useMemo(() => LAYOUT.workers.map((w) => makeWorker(w, w.side === 'B')), [])
  const group = useRef<THREE.Group>(null)
  const stationIndex = useMemo(() => new Map(LINE_STATIONS.map((s, k) => [s.id, k])), [])

  useFrame(() => {
    const t = simClock.t
    const states = LINE_STATIONS.map((_, k) => stationAt(result, k, t))
    for (const r of rigs) {
      const st = states[stationIndex.get(r.spot.station)!]
      const since = st.rack ? st.rack.since : 0
      apply(r, workerPose(st.state, t, since, r.phase), t)
    }
  })

  return (
    <group ref={group}>
      {rigs.map((r) => <primitive key={r.spot.id} object={r.root} />)}
    </group>
  )
}
