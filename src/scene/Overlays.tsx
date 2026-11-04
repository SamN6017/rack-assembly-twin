import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getPart } from '../data/parts'
import { LAYOUT } from '../layout/factoryLayout'
import { useSim } from '../store/simStore'
import { useUi } from '../store/uiStore'
import { STATE_STYLE } from '../ui/kanbanUi'

const PLATE_Y = 0.008
const FLAG_Y = 3.1
const BAR_MAX = 1.6
const OK = new THREE.Color('#22c55e'), LOW = new THREE.Color('#f59e0b'), OUT = new THREE.Color('#ef4444'), UNKNOWN = new THREE.Color('#6b7280')

const plateGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
const flagGeo = new THREE.BoxGeometry(0.42, 0.42, 0.06)
const barGeo = new THREE.BoxGeometry(0.16, 1, 0.16).translate(0, 0.5, 0)
const plateMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })
const flagMat = new THREE.MeshBasicMaterial({ toneMapped: false })
const barMat = new THREE.MeshStandardMaterial({ roughness: 0.6, emissiveIntensity: 0.4 })

const POUS = LAYOUT.stations.flatMap((s) => s.pou.map((p) => ({ key: `${s.id}:${p.pn}`, part: getPart(p.pn), x: p.x, z: p.z })))

/**
 * Inventory overlay: Kanban slots tinted by card state (floor plate plus a flag above the row),
 * and a fill gauge beside every point-of-use pallet (green covers a rack, amber cannot, red starved).
 * Purely visual; the meshes carry no pointer handlers, so picking goes through to the pallets.
 */
export function Overlays() {
  const on = useUi((s) => s.layers.overlays)
  const snapshot = useSim((s) => s.snapshot)
  const plates = useRef<THREE.InstancedMesh>(null)
  const flags = useRef<THREE.InstancedMesh>(null)
  const bars = useRef<THREE.InstancedMesh>(null)

  const plateMatrices = useMemo(() => LAYOUT.slots.map((s) => {
    const r = s.rect
    return new THREE.Matrix4().compose(
      new THREE.Vector3((r.minX + r.maxX) / 2, PLATE_Y, (r.minZ + r.maxZ) / 2),
      new THREE.Quaternion(),
      new THREE.Vector3(r.maxX - r.minX, 1, r.maxZ - r.minZ),
    )
  }), [])

  useLayoutEffect(() => {
    if (!on) return
    const c = new THREE.Color()
    LAYOUT.slots.forEach((slot, i) => {
      const state = snapshot.cards.get(slot.id)?.state ?? 'FULL'
      c.set(STATE_STYLE[state].hex)
      plates.current!.setMatrixAt(i, plateMatrices[i])
      plates.current!.setColorAt(i, c)
      const r = slot.rect
      flags.current!.setMatrixAt(i, new THREE.Matrix4().makeTranslation((r.minX + r.maxX) / 2, FLAG_Y, slot.side === 'N' ? r.maxZ : r.minZ))
      flags.current!.setColorAt(i, c)
    })
    const m = new THREE.Matrix4()
    POUS.forEach((p, i) => {
      const pcs = snapshot.pou.get(p.key)
      const owed = snapshot.backorder.get(p.key) ?? 0
      const known = pcs !== undefined && p.part.qtyPerPallet && p.part.qtyPerRack
      const fill = known ? pcs / p.part.qtyPerPallet! : 1
      const h = Math.max(0.06, fill * BAR_MAX)
      m.compose(new THREE.Vector3(p.x, 0, p.z + 0.78), new THREE.Quaternion(), new THREE.Vector3(1, h, 1))
      bars.current!.setMatrixAt(i, m)
      bars.current!.setColorAt(i, !known ? UNKNOWN : owed > 0 ? OUT : pcs < p.part.qtyPerRack! ? LOW : OK)
    })
    for (const mesh of [plates.current!, flags.current!, bars.current!]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [on, snapshot, plateMatrices])

  return (
    <group visible={on}>
      <instancedMesh ref={plates} args={[plateGeo, plateMat, LAYOUT.slots.length]} frustumCulled={false} renderOrder={1} />
      <instancedMesh ref={flags} args={[flagGeo, flagMat, LAYOUT.slots.length]} frustumCulled={false} />
      <instancedMesh ref={bars} args={[barGeo, barMat, POUS.length]} frustumCulled={false} castShadow />
    </group>
  )
}

const alertRingGeo = new THREE.RingGeometry(0.95, 1.2, 40).rotateX(-Math.PI / 2)
const beaconGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16)
const alertMat = new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, depthWrite: false, toneMapped: false })
const POU_AT = new Map(POUS.map((p) => [p.key, p]))

/**
 * Stopped-line markers: a pulsing red ring and beacon at every POU the line is waiting for. Shown
 * whatever the overlay layer setting, because a stopped line is operational status, not decoration.
 */
export function LineAlerts() {
  const line = useSim((s) => s.snapshot.line)
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    alertMat.opacity = 0.55 + 0.4 * Math.sin(clock.elapsedTime * 5)
  })
  if (!line.blocked) return null
  return (
    <group ref={group}>
      {line.keys.map((k) => {
        const p = POU_AT.get(k)
        if (!p) return null
        return (
          <group key={k} position={[p.x, 0, p.z]}>
            <mesh geometry={alertRingGeo} material={alertMat} position={[0, 0.012, 0]} renderOrder={2} />
            <mesh geometry={beaconGeo} material={alertMat} position={[0, 2.6, 0]} />
          </group>
        )
      })}
    </group>
  )
}
