import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { buildConveyor, floorTape, guardRail } from '../assets/geometry/conveyor'
import { GeoBuilder } from '../assets/geometry/builder'
import { MATERIALS } from '../assets/materials'
import type { RenderPart } from '../assets/loadAsset'
import { BUILDING, CONVEYOR } from '../layout/constants'
import { LAYOUT } from '../layout/factoryLayout'
import { LINE_STATIONS, stationAt, type StationState } from '../sim/assemblyLine'
import { simClock, useSim } from '../store/simStore'
import { PartsInstances, mat4 } from './Instanced'
import { stationSignTexture } from './labelTexture'

const toRender = (b: GeoBuilder): RenderPart[] => b.build().map((p) => ({ geometry: p.geometry, material: MATERIALS[p.mat] }))
const IDENTITY = [new THREE.Matrix4()]

/** Conveyor beds, floor tape round them, the guard rail on the main-aisle side and the staging lane. */
function Static() {
  const parts = useMemo(() => {
    const c = LAYOUT.conveyor
    const b = buildConveyor(c)
    const o = 0.35
    for (const r of c.rects) floorTape(b, [{ x: r.minX - o, z: r.minZ - o }, { x: r.maxX + o, z: r.minZ - o }, { x: r.maxX + o, z: r.maxZ + o }, { x: r.minX - o, z: r.maxZ + o }, { x: r.minX - o, z: r.minZ - o }])
    // Rack roll-off lane into finished staging, dashed.
    floorTape(b, c.stagingLane, 0.06, 'floorWhite', 0.4)
    floorTape(b, [{ x: LAYOUT.finishedRackSpots[0].x - 0.8, z: c.laneZ }, { x: CONVEYOR.laneX, z: c.laneZ }], 0.06, 'floorWhite', 0.4)
    // Guard rail between the outfeed and the main aisle, and across the end of the line.
    const east = c.rects[2]
    guardRail(b, { x: east.maxX + 0.25, z: east.minZ + 1.6 }, { x: east.maxX + 0.25, z: c.rects[1].maxZ + 0.3 })
    guardRail(b, { x: c.rects[1].minX, z: c.rects[1].maxZ + 0.3 }, { x: east.maxX + 0.25, z: c.rects[1].maxZ + 0.3 })
    // Lowering table at the outfeed end, hatched yellow.
    b.box('safetyYellow', CONVEYOR.bedWidth, 0.02, 1.0, CONVEYOR.outfeedX, 0.012, CONVEYOR.endZ + 0.5)
    return toRender(b)
  }, [])
  return <PartsInstances parts={parts} matrices={IDENTITY} />
}

/** High-bay LED fixtures in rows under the roof (emissive panels; lighting itself is global). */
function Fixtures() {
  const parts = useMemo(() => toRender(new GeoBuilder().box('lampWhite', 0.5, 0.06, 1.4, 0, 0, 0).box('steelGrey', 0.56, 0.08, 1.46, 0, 0.07, 0)), [])
  const m = useMemo(() => {
    const out: THREE.Matrix4[] = []
    for (let x = BUILDING.minX + 6; x < BUILDING.maxX - 3; x += 6) for (let z = BUILDING.minZ + 5; z < BUILDING.maxZ - 3; z += 7.5) out.push(mat4(x, BUILDING.wallHeight - 1.6, z))
    return out
  }, [])
  return <PartsInstances parts={parts} matrices={m} shadows={false} />
}

const LAMP = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#3b82f6' }
const lampFor = (s: StationState): keyof typeof LAMP | null => (s === 'assembling' ? 'green' : s === 'blocked' ? 'red' : s === 'waiting' || s === 'transfer' ? 'amber' : null)

/**
 * Per station: hanging sign, tool balancer over the rack, and a stack light on the bench that shows
 * the station state (green assembling, amber waiting or rack moving, red short of material).
 */
function StationKit() {
  const result = useSim((s) => s.result)
  const kit = useMemo(() => {
    const b = new GeoBuilder()
    for (const s of LINE_STATIONS) {
      // Stack light pole on the bench's north end.
      b.box('steelGrey', 0.04, 0.9, 0.04, s.bench.x, 1.35, s.bench.z - 0.75)
      // Tool balancer: cable from the roof structure to a nutrunner above the rack position.
      b.cyl('steelDark', 0.006, 2.2, s.rack.x + 0.75, 3.1, s.rack.z, 'y', 6)
      b.box('steelDark', 0.08, 0.08, 0.08, s.rack.x + 0.75, 4.2, s.rack.z)
      b.cyl('bezelBlack', 0.035, 0.32, s.rack.x + 0.75, 1.9, s.rack.z, 'y', 10)
      b.box('beamOrange', 0.05, 0.05, 0.14, s.rack.x + 0.75, 1.74, s.rack.z + 0.05)
    }
    return toRender(b)
  }, [])
  // One material per lamp so each station can light its own.
  const lamps = useMemo(() => LINE_STATIONS.map(() => (['red', 'amber', 'green'] as const).map((c) => new THREE.MeshStandardMaterial({ color: LAMP[c], roughness: 0.3, emissive: LAMP[c], emissiveIntensity: 0, transparent: true, opacity: 0.85 }))), [])
  const lampGeo = useMemo(() => new THREE.CylinderGeometry(0.055, 0.055, 0.1, 16), [])
  const signs = useMemo(() => LINE_STATIONS.map((s, k) => {
    // Testing fits no parts: its sign is muted to show the operation has no data behind it.
    const noParts = s.steps.length === 0
    return { s, tex: stationSignTexture(`Station ${k + 1}`, s.name, noParts ? 'No parts in sheet · timing placeholder' : `Sheet steps ${s.steps.join(', ')}`, noParts) }
  }), [])
  const last = useRef<string>('')
  useFrame(() => {
    const states = LINE_STATIONS.map((_, k) => lampFor(stationAt(result, k, simClock.t).state))
    const sig = states.join()
    if (sig === last.current) return
    last.current = sig
    states.forEach((on, k) => lamps[k].forEach((m, i) => { m.emissiveIntensity = on === (['red', 'amber', 'green'] as const)[i] ? 2.4 : 0.02 }))
  })
  return (
    <group>
      <PartsInstances parts={kit} matrices={IDENTITY} />
      {LINE_STATIONS.map((s, k) => (
        <group key={s.id} position={[s.bench.x, 1.85, s.bench.z - 0.75]}>
          {lamps[k].map((m, i) => <mesh key={i} geometry={lampGeo} material={m} position={[0, i * 0.105, 0]} />)}
        </group>
      ))}
      {signs.map(({ s, tex }) => (
        <group key={s.id} position={[s.rack.x, 3.6, s.rack.z]}>
          {/* Two faces so the sign reads from both sides of the line. */}
          <mesh rotation-y={Math.PI / 2} position={[0.03, 0, 0]}><planeGeometry args={[1.6, 0.8]} /><meshStandardMaterial map={tex} roughness={0.6} /></mesh>
          <mesh rotation-y={-Math.PI / 2} position={[-0.03, 0, 0]}><planeGeometry args={[1.6, 0.8]} /><meshStandardMaterial map={tex} roughness={0.6} /></mesh>
          <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.006, 0.006, 1.0, 6]} /><meshStandardMaterial color="#555" /></mesh>
        </group>
      ))}
    </group>
  )
}

/** The physical assembly line added in V2: conveyor, station kit and overhead lighting. */
export function AssemblyLine() {
  return (
    <group>
      <Static />
      <Fixtures />
      <StationKit />
    </group>
  )
}
