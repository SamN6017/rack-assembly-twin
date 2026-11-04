import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { buildCarrier, buildCompletedRack, buildRackAtStage, buildRackFrame } from '../assets/geometry/serverRack'
import type { GeoBuilder } from '../assets/geometry/builder'
import { MATERIALS } from '../assets/materials'
import type { RenderPart } from '../assets/loadAsset'
import { N_STATIONS, racksAt, type RackView } from '../sim/assemblyLine'
import { simClock, useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { objectRegistry, pickHandlers } from './picking'

const toRender = (b: GeoBuilder): RenderPart[] => b.build().map((p) => ({ geometry: p.geometry, material: MATERIALS[p.mat] }))

// Rack front (+Z in model space) faces the bench on the main-aisle side (+X), all along the line.
const FACE_BENCH = Math.PI / 2

/**
 * Appearance by stations finished: 0 = bare frame (WS1 still working), 1–7 = through that station,
 * 8 = complete with the green "passed" beacon. Built once and shared by every rack.
 */
let models: RenderPart[][] | null = null
const modelFor = (done: number) => {
  models ??= [toRender(buildRackFrame()), ...Array.from({ length: N_STATIONS - 1 }, (_, i) => toRender(buildRackAtStage(i))), toRender(buildCompletedRack())]
  return models[Math.min(done, N_STATIONS)]
}
let carrier: RenderPart[] | null = null

const ring = new THREE.RingGeometry(0.85, 0.95, 40).rotateX(-Math.PI / 2)
const ringMat = new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.9, depthWrite: false })

/** Current racks keyed by number, with what they look like; positions are written every frame. */
const signature = (vs: RackView[]) => vs.map((v) => `${v.rack}:${v.stationsDone}:${v.y > 0 ? 1 : 0}`).join('|')

const Rack = memo(function Rack({ rack, done, onCarrier, start, register }: { rack: number; done: number; onCarrier: boolean; start: RackView; register: (rack: number, g: THREE.Group | null) => void }) {
  const ref = useRef<THREE.Group>(null)
  // Place a newly mounted rack before its first frame; after that the frame loop moves it.
  useLayoutEffect(() => { ref.current?.position.set(start.x, start.y, start.z) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const id = `linerack:${rack}`
  const selected = useUi((s) => s.selected === id)
  useEffect(() => {
    register(rack, ref.current)
    if (ref.current) objectRegistry.set(id, ref.current)
    return () => { register(rack, null); objectRegistry.delete(id) }
  }, [rack, id, register])
  const handlers = useMemo(() => pickHandlers(() => id), [id])
  carrier ??= toRender(buildCarrier())
  return (
    <group ref={ref} {...handlers}>
      <group rotation-y={FACE_BENCH}>
        {modelFor(done).map((p, i) => <mesh key={i} geometry={p.geometry} material={p.material} castShadow={!p.material.transparent} receiveShadow />)}
        {onCarrier && carrier.map((p, i) => <mesh key={`c${i}`} geometry={p.geometry} material={p.material} receiveShadow />)}
      </group>
      {selected && <mesh geometry={ring} material={ringMat} position={[0, 0.02, 0]} raycast={() => null} />}
    </group>
  )
})

/**
 * GPU racks on the assembly line, the outfeed and in finished staging. Each rack is one object
 * that keeps its identity from WS1 to staging; its pose and appearance come from the simulation
 * (assemblyLine.rackAt), so pause, speed and reset need nothing special.
 */
export function LineRacks() {
  const result = useSim((s) => s.result)
  const [list, setList] = useState<RackView[]>(() => racksAt(result, simClock.t))
  const groups = useRef(new Map<number, THREE.Group>())
  const sig = useRef(signature(list))
  const register = useMemo(() => (rack: number, g: THREE.Group | null) => {
    if (g) groups.current.set(rack, g)
    else groups.current.delete(rack)
  }, [])

  useFrame(() => {
    const vs = racksAt(result, simClock.t)
    const s = signature(vs)
    if (s !== sig.current) {
      sig.current = s
      setList(vs)
    }
    for (const v of vs) groups.current.get(v.rack)?.position.set(v.x, v.y, v.z)
  })

  return (
    <group>
      {list.map((v) => <Rack key={v.rack} rack={v.rack} done={v.stationsDone} onCarrier={v.y > 0} start={v} register={register} />)}
    </group>
  )
}
