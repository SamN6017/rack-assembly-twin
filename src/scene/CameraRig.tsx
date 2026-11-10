import { CameraControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { LAYOUT } from '../layout/factoryLayout'
import { useUi, type CameraPreset } from '../store/uiStore'
import { resolveEntity } from './entities'
import { objectRegistry } from './picking'

type View = [px: number, py: number, pz: number, tx: number, ty: number, tz: number]

const b = LAYOUT.building
const cx = (b.minX + b.maxX) / 2
const cz = (b.minZ + b.maxZ) / 2
// Line close-up: the wiring station, where the most parts go on.
const lineView = LAYOUT.stations.find((s) => s.id === 'ST3')!
const kz = (LAYOUT.kanbanArea.minZ + LAYOUT.kanbanArea.maxZ) / 2

export const VIEWS: Record<CameraPreset, View> = {
  iso: [cx + 45, 75, b.maxZ + 55, cx + 4, 0, cz + 2],
  top: [cx, 135, cz + 0.01, cx, 0, cz],
  line: [lineView.rack.x + 3.4, 2.3, lineView.rack.z + 3.2, lineView.rack.x, 1.1, lineView.rack.z],
  kanban: [LAYOUT.kanbanArea.maxX + 14, 16, kz + 22, 12, 0, kz],
  dsv: [-6, 22, 46, -25, 2, 20],
}

/** Smallest box the camera will frame, so a single pallet doesn't fill the screen. */
const MIN_FRAME = 3.5
const MIN_ELEVATION = THREE.MathUtils.degToRad(28)

/** World position the follow camera tracks: the live object if registered, else the entity bounds. */
function followPosition(id: string, out: THREE.Vector3): boolean {
  const obj = objectRegistry.get(id)
  const e = resolveEntity(id)
  if (obj) {
    obj.getWorldPosition(out)
    out.y += e ? e.bounds.h / 2 : 1
    return true
  }
  if (!e) return false
  out.set(e.bounds.x, e.bounds.y, e.bounds.z)
  return true
}

export function CameraRig() {
  const ref = useRef<CameraControls>(null)
  const camera = useUi((s) => s.camera)
  const focusNonce = useUi((s) => s.focusNonce)
  const walking = useUi((s) => s.cameraMode === 'walk')
  const scratch = useRef({ want: new THREE.Vector3(), have: new THREE.Vector3() })

  useEffect(() => {
    ref.current?.setLookAt(...VIEWS[camera.preset], camera.nonce > 0)
  }, [camera])

  useEffect(() => {
    const id = useUi.getState().selected
    const e = id ? resolveEntity(id) : null
    if (!focusNonce || !e || !ref.current) return
    // Keep the current viewing direction but look down at least MIN_ELEVATION, so the camera
    // never ends up level with (or inside) neighbouring pallets. fitToBox would level it.
    const { x, y, z, w, h, d } = e.bounds
    const radius = 0.5 * Math.hypot(Math.max(w, MIN_FRAME), Math.max(h, MIN_FRAME * 0.6), Math.max(d, MIN_FRAME))
    const cam = ref.current.camera as THREE.PerspectiveCamera
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(cam.fov) / 2)) * 1.05
    const target = new THREE.Vector3(x, y, z)
    const dir = cam.position.clone().sub(ref.current.getTarget(new THREE.Vector3())).normalize()
    const horiz = Math.hypot(dir.x, dir.z) || 1
    const elev = Math.max(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), MIN_ELEVATION)
    const pos = new THREE.Vector3((dir.x / horiz) * Math.cos(elev), Math.sin(elev), (dir.z / horiz) * Math.cos(elev)).multiplyScalar(dist).add(target)
    ref.current.setLookAt(pos.x, pos.y, pos.z, x, y, z, true)
  }, [focusNonce])

  useFrame(() => {
    const id = useUi.getState().follow
    const controls = ref.current
    if (!id || !controls || useUi.getState().cameraMode === 'walk') return
    const { want, have } = scratch.current
    if (!followPosition(id, want)) return
    controls.getTarget(have)
    if (have.distanceToSquared(want) > 1e-4) controls.moveTo(want.x, want.y, want.z, true)
  })

  return (
    <CameraControls
      ref={ref}
      makeDefault
      enabled={!walking}
      minDistance={1.5}
      maxDistance={260}
      maxPolarAngle={Math.PI / 2 - 0.04}
      smoothTime={0.45}
    />
  )
}
