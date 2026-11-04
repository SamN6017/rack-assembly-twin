import { LineAlerts, Overlays } from './Overlays'
import { Environment, Lightformer } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { memo, useState } from 'react'
import * as THREE from 'three'
import { BUILDING } from '../layout/constants'
import { Building } from './Building'
import { CameraRig, VIEWS } from './CameraRig'
import { FirstPerson } from './FirstPerson'
import { AssemblyLine } from './AssemblyLine'
import { LineRacks } from './LineRacks'
import { Workers } from './Workers'
import { DsvArea } from './DsvArea'
import { Equipment } from './Equipment'
import { FloorMarkings } from './FloorMarkings'
import { KanbanArea } from './KanbanArea'
import { Labels } from './Labels'
import { ProductionLine } from './ProductionLine'
import { Selection } from './Selection'
import { Handlers } from './Handlers'
import { Routes, SimDriver, StagingLane } from './SimLayer'
import { useUi } from '../store/uiStore'

// Pointer-down position, so releasing an orbit drag over empty floor doesn't clear the selection.
const down = { x: 0, y: 0 }
const onPointerDown = (e: React.PointerEvent) => { down.x = e.clientX; down.y = e.clientY }
const onPointerMissed = (e: MouseEvent) => {
  if (useUi.getState().cameraMode === 'walk') return
  if (e.type === 'click' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) useUi.getState().select(null)
}

const CX = (BUILDING.minX + BUILDING.maxX) / 2
const CZ = (BUILDING.minZ + BUILDING.maxZ) / 2
const HALF = Math.max(BUILDING.maxX - BUILDING.minX, BUILDING.maxZ - BUILDING.minZ) / 2 + 4

function Lights() {
  // The light target must be in the scene graph or its world matrix never updates.
  const [target] = useState(() => new THREE.Object3D())
  return (
    <>
      <hemisphereLight args={['#dfe6ee', '#3a3a38', 0.55]} />
      <primitive object={target} position={[CX, 0, CZ]} />
      <directionalLight
        target={target}
        position={[CX + 30, 70, CZ + 25]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-HALF}
        shadow-camera-right={HALF}
        shadow-camera-top={HALF}
        shadow-camera-bottom={-HALF}
        shadow-camera-near={10}
        shadow-camera-far={200}
      />
      {/* Local light-box environment: rows of high-bay fixtures for metal reflections, no network fetch. */}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#202224']} />
        {[-30, -10, 10, 30].map((x) => (
          <Lightformer key={x} form="rect" intensity={2.2} position={[x, 12, 0]} rotation-x={Math.PI / 2} scale={[4, 60, 1]} />
        ))}
        <Lightformer form="rect" intensity={0.6} position={[0, 4, -40]} scale={[80, 8, 1]} color="#cfd8e0" />
      </Environment>
    </>
  )
}

const CAMERA = { position: VIEWS.iso.slice(0, 3) as [number, number, number], fov: 42, near: 0.1, far: 700 }
const GL = { antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }

/**
 * Memoised with stable props: if the Canvas re-renders, R3F reconnects its event target and every
 * drei <Html> (labels, tooltip) tears down and rebuilds its React root mid-render, which throws.
 */
export const FactoryScene = memo(function FactoryScene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={CAMERA}
      gl={GL}
      onPointerDown={onPointerDown}
      onPointerMissed={onPointerMissed}
    >
      <color attach="background" args={['#15171a']} />
      <fog attach="fog" args={['#15171a', 160, 420]} />
      <Lights />
      <Building />
      <FloorMarkings />
      <KanbanArea />
      <DsvArea />
      <ProductionLine />
      <AssemblyLine />
      <LineRacks />
      <Workers />
      <Equipment />
      <StagingLane />
      <Handlers />
      <Overlays />
      <LineAlerts />
      <Routes />
      <SimDriver />
      <Labels />
      <Selection />
      <CameraRig />
      <FirstPerson />
    </Canvas>
  )
})
