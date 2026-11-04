import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getPart } from '../data/parts'
import { loadProfile } from '../assets/manifest'
import { fallbackParts, type RenderPart } from '../assets/loadAsset'
import { PALLET } from '../layout/constants'
import { poseAt, type HandlerTimeline } from '../sim/movementSim'
import type { Phase } from '../sim/timeline'
import { simClock, useSim } from '../store/simStore'
import { displayLevel, useUi } from '../store/uiStore'
import { lineOfSight, walkLabelVisible } from '../sim/labelVisibility'
import { objectRegistry, pickHandlers } from './picking'

const fwd = new THREE.Vector3()
// A handler here stops drei re-showing the tag on its own; the frame loop decides visibility.
const keepDisplay = () => {}

/** Fork lift travel for a manual pallet jack, metres. */
const LIFT = 0.08

const PHASE_TEXT: Record<Phase, string> = {
  idle: 'parked', 'to-pick': 'to pick', turning: 'turning', loading: 'loading', transporting: 'transporting',
  unloading: 'unloading', returning: 'returning', waiting: 'waiting for route',
}

const skin = new THREE.MeshStandardMaterial({ color: '#c58c68', roughness: 0.7 })
const trousers = new THREE.MeshStandardMaterial({ color: '#24282e', roughness: 0.8 })
const vest = new THREE.MeshStandardMaterial({ color: '#d7e52a', roughness: 0.6, emissive: '#3a4205', emissiveIntensity: 0.4 })
const reflective = new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.25, metalness: 0.6 })
const hardHat = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.4 })
const ringMat = new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.8, depthWrite: false })

function Parts({ parts }: { parts: RenderPart[] }) {
  return <>{parts.map((p, i) => <mesh key={i} geometry={p.geometry} material={p.material} castShadow={!p.material.transparent} receiveShadow />)}</>
}

/** Simple operator figure (illustrative): hi-vis vest and hard hat, legs swing with walking speed. */
function Operator({ legL, legR }: { legL: React.RefObject<THREE.Group | null>; legR: React.RefObject<THREE.Group | null> }) {
  return (
    <group>
      {([[legL, -0.1], [legR, 0.1]] as const).map(([ref, x]) => (
        <group key={x} ref={ref} position={[x, 0.88, 0]}>
          <mesh position={[0, -0.43, 0]} material={trousers} castShadow><boxGeometry args={[0.13, 0.86, 0.15]} /></mesh>
        </group>
      ))}
      <mesh position={[0, 1.17, 0]} material={vest} castShadow><boxGeometry args={[0.4, 0.58, 0.23]} /></mesh>
      <mesh position={[0, 1.05, 0]} material={reflective}><boxGeometry args={[0.41, 0.04, 0.24]} /></mesh>
      <mesh position={[0, 1.3, 0]} material={reflective}><boxGeometry args={[0.41, 0.04, 0.24]} /></mesh>
      <mesh position={[0, 1.59, 0]} material={skin} castShadow><sphereGeometry args={[0.11, 16, 12]} /></mesh>
      <mesh position={[0, 1.64, 0]} material={hardHat} castShadow><sphereGeometry args={[0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      {[-0.24, 0.24].map((x) => (
        <mesh key={x} position={[x, 1.18, -0.12]} rotation-x={0.5} material={vest} castShadow><boxGeometry args={[0.08, 0.55, 0.09]} /></mesh>
      ))}
    </group>
  )
}

function Handler({ tl }: { tl: HandlerTimeline }) {
  const root = useRef<THREE.Group>(null)
  const carried = useRef<THREE.Group>(null)
  const person = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const tag = useRef<HTMLDivElement>(null)
  const loadRefs = { cartonStack: useRef<THREE.Group>(null), crate: useRef<THREE.Group>(null), wrappedRack: useRef<THREE.Group>(null) }
  const entityId = `handler:${tl.id}`
  const selected = useUi((s) => s.selected === entityId)
  const tagBox = useRef<HTMLDivElement>(null)

  const parts = useMemo(() => ({
    jack: fallbackParts('palletJack'),
    pallet: fallbackParts('pallet'),
    cartonStack: fallbackParts('cartonStack'),
    crate: fallbackParts('crate'),
    wrappedRack: fallbackParts('wrappedRack'),
  }), [])
  const handlers = useMemo(() => pickHandlers(() => entityId), [entityId])

  useEffect(() => {
    if (!root.current) return
    objectRegistry.set(entityId, root.current)
    return () => { objectRegistry.delete(entityId) }
  }, [entityId])

  const last = useRef({ pn: '', text: '', shown: false })
  useFrame((state) => {
    const p = poseAt(tl, simClock.t)
    const g = root.current
    if (!g) return
    g.position.set(p.x, 0, p.z)
    g.rotation.y = p.yaw

    // Operator walks ahead when pulling; turns to face the forks when pushing in or handling a load.
    if (person.current) {
      person.current.position.z = p.facingForks ? 1.3 : 1.45
      person.current.rotation.y = p.facingForks ? Math.PI : 0
    }
    const swing = p.speed > 0.05 ? Math.sin(simClock.t * 7) * Math.min(0.45, p.speed * 0.4) : 0
    if (legL.current) legL.current.rotation.x = swing
    if (legR.current) legR.current.rotation.x = -swing

    if (carried.current) {
      carried.current.visible = !!p.load
      carried.current.position.y = 0.01 + p.lift * LIFT
    }
    const pn = p.load?.pn ?? ''
    if (pn !== last.current.pn) {
      last.current.pn = pn
      const prof = pn ? loadProfile(getPart(pn)) : null
      for (const [k, ref] of Object.entries(loadRefs)) {
        const grp = ref.current
        if (!grp) continue
        const kind = k === 'wrappedRack' ? 'rack' : k === 'crate' ? 'crate' : 'carton'
        grp.visible = !!prof && prof.kind === kind
        grp.scale.y = prof && kind !== 'rack' ? prof.height : 1
      }
    }
    // Status tags are detail-level information: shown at Detailed only, never through geometry,
    // and in first-person only when the handler is near and in view.
    const ui = useUi.getState()
    const walking = ui.cameraMode === 'walk'
    const show = ui.layers.labels && (walking || ui.tab === 'factory') && displayLevel(ui) === 'detailed' &&
      (walking
        ? walkLabelVisible(state.camera.position, state.camera.getWorldDirection(fwd), { x: p.x, y: 2.25, z: p.z }, last.current.shown)
        : lineOfSight(state.camera.position, { x: p.x, y: 2.25, z: p.z }))
    last.current.shown = show
    if (tagBox.current && (tagBox.current.style.display === 'none') === show) tagBox.current.style.display = show ? 'block' : 'none'
    const text = `${tl.id} · ${PHASE_TEXT[p.phase]}${p.load ? ` · ${p.load.pn}` : ''}`
    if (tag.current && text !== last.current.text) {
      last.current.text = text
      tag.current.textContent = text
    }
  })

  return (
    <group ref={root} {...handlers}>
      <Parts parts={parts.jack} />
      <group ref={person}><Operator legL={legL} legR={legR} /></group>
      {/* Pallet on the forks: its length runs along the forks (model Z). */}
      <group ref={carried} visible={false}>
        <Parts parts={parts.pallet} />
        {(['cartonStack', 'crate', 'wrappedRack'] as const).map((k) => (
          <group key={k} ref={loadRefs[k]} position-y={PALLET.height} visible={false}>
            <Parts parts={parts[k]} />
          </group>
        ))}
      </group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.015} visible={selected} material={ringMat} raycast={() => null}>
        <ringGeometry args={[1.25, 1.4, 48]} />
      </mesh>
      <Html ref={tagBox} position={[0, 2.25, 0.6]} center zIndexRange={[25, 10]} onOcclude={keepDisplay} style={{ pointerEvents: 'none', display: 'none' }}>
        <div ref={tag} className="whitespace-nowrap rounded bg-amber-950/85 px-1.5 py-0.5 font-mono text-[10px] text-amber-100 ring-1 ring-amber-400/40" />
      </Html>
    </group>
  )
}

export function Handlers() {
  const handlers = useSim((s) => s.result.handlers)
  return <>{handlers.map((h) => <Handler key={h.id} tl={h} />)}</>
}
